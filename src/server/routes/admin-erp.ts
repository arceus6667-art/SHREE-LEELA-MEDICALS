import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { sqlite, databaseService } from '../db/sqlite-db.ts';
import { requireRoles, type AuthenticatedRequest } from '../services/auth-service.ts';
import { storageService } from '../services/storage-service.ts';
import { notificationService } from '../services/notification-service.ts';
import { createSignedFileUrl } from '../services/security-service.ts';
import { PaymentStatus, PublicationStatus, PurchaseOrderStatus, Role } from '../../shared/types.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function sanitizeAuditMeta(obj: Record<string, unknown>): string {
  const blocked = new Set(['password', 'passwordHash', 'password_hash', 'token', 'licenseNumber', 'nationalId']);
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!blocked.has(k)) clean[k] = v;
  }
  return JSON.stringify(clean);
}

function logAudit(
  req: AuthenticatedRequest,
  action: string,
  entityType: string,
  entityId: string,
  meta?: Record<string, unknown>
): void {
  sqlite
    .prepare(
      `INSERT INTO audit_logs (id, business_id, store_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      req.auth!.businessId,
      req.auth!.storeId,
      req.auth!.userId,
      action,
      entityType,
      entityId,
      meta ? sanitizeAuditMeta(meta) : null,
      new Date().toISOString()
    );
}

export function createAdminErpRouter(): Router {
  const router = Router();

  // =========================================================================
  // 1. BULK INVENTORY IMPORT & EXPORT (CSV + XLSX)
  // =========================================================================
  router.get('/medicines/import-template', (req, res) => {
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const sampleRows = [
      {
        name: 'Azithromycin 500mg Tablets',
        generic_name: 'Azithromycin',
        composition: 'Azithromycin IP 500 mg',
        manufacturer: 'Apex Care Formulations (Demo)',
        brand: 'AzithroCare',
        category_slug: 'tablets-and-capsules',
        dosage_form: 'Tablet',
        strength: '500 mg',
        pack_size: 'Strip of 5 Tablets',
        sku: 'SLM-DEMO-901',
        barcode: '8901234569011',
        hsn_code: '30042099',
        gst_percent: 12,
        mrp_rupees: 118,
        sale_price_rupees: 102,
        requires_prescription: 'YES',
        schedule_type: 'Schedule H',
        batch_number: 'AZI-2601',
        mfg_date: '2026-01-15',
        expiry_date: '2028-01-15',
        initial_stock: 40,
        purchase_price_rupees: 78,
        storage_conditions: 'Store below 25°C',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'MedicineImportTemplate');

    if (format === 'xlsx') {
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="shree_leela_medicine_import_template.xlsx"');
      res.send(buf);
      return;
    }

    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="shree_leela_medicine_import_template.csv"');
    res.send(csv);
  });

  router.get('/medicines/export', (req: AuthenticatedRequest, res) => {
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const rows = sqlite
      .prepare(
        `SELECT m.sku, m.barcode, m.name, m.generic_name, m.brand, m.composition,
                c.name as category_name, m.dosage_form, m.strength, m.pack_size,
                m.schedule_type, m.requires_prescription, m.hsn_code, m.gst_percent,
                ROUND(m.mrp_paise / 100.0, 2) as mrp_inr,
                ROUND(m.sale_price_paise / 100.0, 2) as sale_price_inr,
                COALESCE(m.publication_status, 'PUBLISHED') as publication_status,
                m.is_pharmacist_approved,
                COALESCE((SELECT SUM(quantity_available) FROM medicine_batches WHERE medicine_id = m.id AND store_id = ?), 0) as total_available_stock
         FROM medicines m
         JOIN categories c ON c.id = m.category_id
         WHERE m.business_id = ?
         ORDER BY m.name ASC`
      )
      .all(req.auth!.storeId, req.auth!.businessId) as Array<Record<string, unknown>>;

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogue');

    if (format === 'xlsx') {
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="shree_leela_catalogue_export.xlsx"');
      res.send(buf);
      return;
    }

    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="shree_leela_catalogue_export.csv"');
    res.send(csv);
  });

  router.get('/medicines/import-jobs', (req: AuthenticatedRequest, res) => {
    const jobs = sqlite
      .prepare(
        `SELECT bij.*, u.full_name as uploaded_by_name
         FROM bulk_import_jobs bij
         LEFT JOIN users u ON u.id = bij.uploaded_by
         WHERE bij.store_id = ?
         ORDER BY bij.created_at DESC
         LIMIT 25`
      )
      .all(req.auth!.storeId);
    res.json({ jobs });
  });

  router.get('/medicines/barcode/:code', (req: AuthenticatedRequest, res) => {
    const code = req.params.code.trim();
    const row = sqlite
      .prepare(
        `SELECT m.*, c.name as category_name, mf.name as manufacturer_name,
                COALESCE((SELECT SUM(quantity_available) FROM medicine_batches WHERE medicine_id = m.id AND store_id = ?), 0) as available_stock
         FROM medicines m
         JOIN categories c ON c.id = m.category_id
         JOIN manufacturers mf ON mf.id = m.manufacturer_id
         WHERE m.business_id = ? AND (m.barcode = ? OR m.sku = ?)`
      )
      .get(req.auth!.storeId, req.auth!.businessId, code, code);
    res.json({ medicine: row || null });
  });

  router.post(
    '/medicines/import',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.PHARMACIST, Role.INVENTORY_MANAGER]),
    (req: AuthenticatedRequest, res) => {
      const rowSchema = z.object({
        name: z.string().trim().min(2),
        genericName: z.string().trim().min(2),
        composition: z.string().trim().min(2),
        manufacturer: z.string().trim().min(2).optional().default('Apex Care Formulations (Demo)'),
        brand: z.string().trim().optional().nullable(),
        categorySlug: z.string().trim().optional().default('tablets-and-capsules'),
        dosageForm: z.string().trim().optional().default('Tablet'),
        strength: z.string().trim().optional().nullable(),
        packSize: z.string().trim().optional().default('Strip of 10 Tablets'),
        sku: z.string().trim().min(2),
        barcode: z.string().trim().optional().nullable(),
        hsnCode: z.string().trim().optional().nullable(),
        gstPercent: z.number().int().min(0).max(28).optional().default(12),
        mrpPaise: z.number().int().min(100),
        salePricePaise: z.number().int().min(100),
        requiresPrescription: z.boolean().optional().default(false),
        scheduleType: z.enum(['OTC', 'Schedule H', 'Schedule H1']).optional().default('OTC'),
        batchNumber: z.string().trim().min(2).optional().default(`IMP-${Date.now().toString().slice(-4)}`),
        mfgDate: z.string().optional().nullable(),
        expiryDate: z.string().min(8).optional().default('2028-06-30'),
        initialStock: z.number().int().min(0).optional().default(10),
        purchasePricePaise: z.number().int().min(0).optional(),
        storageConditions: z.string().trim().optional().nullable(),
      });

      const bodyParsed = z
        .object({
          fileName: z.string().trim().min(1).max(160).default('bulk_upload.csv'),
          rows: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
        })
        .safeParse(req.body);

      if (!bodyParsed.success) {
        res.status(400).json({ error: 'Provide at least 1 row for import' });
        return;
      }

      const businessId = req.auth!.businessId;
      const storeId = req.auth!.storeId;
      const now = new Date().toISOString();

      const catRows = sqlite.prepare('SELECT id, slug, name FROM categories WHERE business_id = ?').all(businessId) as Array<{
        id: string;
        slug: string;
        name: string;
      }>;
      const catBySlug = new Map(catRows.map((c) => [c.slug.toLowerCase(), c.id]));
      const catByName = new Map(catRows.map((c) => [c.name.toLowerCase(), c.id]));
      const defaultCatId = catRows[0]?.id;

      const existingSkus = new Set(
        (sqlite.prepare('SELECT sku FROM medicines WHERE business_id = ?').all(businessId) as Array<{ sku: string }>).map(
          (r) => r.sku.toUpperCase()
        )
      );
      const existingBarcodes = new Set(
        (
          sqlite
            .prepare('SELECT barcode FROM medicines WHERE business_id = ? AND barcode IS NOT NULL')
            .all(businessId) as Array<{ barcode: string }>
        ).map((r) => r.barcode)
      );

      let insertedRows = 0;
      const errors: Array<{ rowNumber: number; sku: string; message: string }> = [];

      databaseService.withTransaction(() => {
        bodyParsed.data.rows.forEach((raw, idx) => {
          const rowNum = idx + 1;
          const parsed = rowSchema.safeParse(raw);
          if (!parsed.success) {
            errors.push({
              rowNumber: rowNum,
              sku: String(raw.sku || 'UNKNOWN'),
              message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
            });
            return;
          }

          const d = parsed.data;
          const skuUpper = d.sku.toUpperCase();
          if (existingSkus.has(skuUpper)) {
            errors.push({ rowNumber: rowNum, sku: d.sku, message: `Duplicate SKU "${d.sku}" already exists` });
            return;
          }
          if (d.barcode && existingBarcodes.has(d.barcode)) {
            errors.push({ rowNumber: rowNum, sku: d.sku, message: `Duplicate barcode "${d.barcode}" already exists` });
            return;
          }

          const categoryId =
            catBySlug.get(d.categorySlug.toLowerCase()) ||
            catByName.get(d.categorySlug.toLowerCase()) ||
            defaultCatId;
          if (!categoryId) {
            errors.push({ rowNumber: rowNum, sku: d.sku, message: 'No matching pharmacy category found' });
            return;
          }

          let mfrRow = sqlite
            .prepare('SELECT id FROM manufacturers WHERE business_id = ? AND lower(name) = lower(?)')
            .get(businessId, d.manufacturer) as { id: string } | undefined;
          if (!mfrRow) {
            const newMfrId = crypto.randomUUID();
            sqlite
              .prepare('INSERT INTO manufacturers (id, business_id, name, country, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
              .run(newMfrId, businessId, d.manufacturer, 'India', now, now);
            mfrRow = { id: newMfrId };
          }

          const medId = crypto.randomUUID();
          const slug = `${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;

          // All bulk-imported items MUST enter as DRAFT pending pharmacist approval before appearing live!
          sqlite
            .prepare(
              `INSERT INTO medicines (
                id, business_id, category_id, manufacturer_id, sku, barcode, name, slug, generic_name,
                brand, strength, composition, dosage_form, pack_size, schedule_type, requires_prescription,
                mrp_paise, sale_price_paise, gst_percent, hsn_code, storage_instructions,
                is_active, publication_status, is_demo_data, is_pharmacist_approved, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, ?, ?)`
            )
            .run(
              medId,
              businessId,
              categoryId,
              mfrRow.id,
              d.sku,
              d.barcode || null,
              d.name,
              slug,
              d.genericName,
              d.brand || null,
              d.strength || null,
              d.composition,
              d.dosageForm,
              d.packSize,
              d.scheduleType,
              d.requiresPrescription ? 1 : 0,
              d.mrpPaise,
              d.salePricePaise,
              d.gstPercent,
              d.hsnCode || null,
              d.storageConditions || null,
              PublicationStatus.DRAFT,
              now,
              now
            );

          sqlite
            .prepare(
              'INSERT INTO medicine_images (id, medicine_id, image_url, alt_text, is_primary, sort_order, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)'
            )
            .run(crypto.randomUUID(), medId, '/src/assets/images/demo_med_tablets_1795159503038.jpg', `${d.name} image`, now);

          const batchId = crypto.randomUUID();
          sqlite
            .prepare(
              `INSERT INTO medicine_batches (
                id, store_id, medicine_id, batch_number, mfg_date, expiry_date,
                quantity_received, quantity_available, purchase_price_paise, mrp_paise,
                storage_conditions, is_demo_data, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
            )
            .run(
              batchId,
              storeId,
              medId,
              d.batchNumber,
              d.mfgDate || null,
              d.expiryDate,
              d.initialStock,
              d.initialStock,
              d.purchasePricePaise ?? Math.round(d.salePricePaise * 0.72),
              d.mrpPaise,
              d.storageConditions || 'Store in cool, dry place',
              now,
              now
            );

          sqlite
            .prepare(
              `INSERT INTO inventory_transactions (id, store_id, batch_id, txn_type, quantity_delta, reference_type, notes, performed_by_id, created_at)
               VALUES (?, ?, ?, 'PURCHASE_RECEIPT', ?, 'BULK_IMPORT', ?, ?, ?)`
            )
            .run(crypto.randomUUID(), storeId, batchId, d.initialStock, `Imported from ${bodyParsed.data.fileName}`, req.auth!.userId, now);

          existingSkus.add(skuUpper);
          if (d.barcode) existingBarcodes.add(d.barcode);
          insertedRows++;
        });

        const jobId = crypto.randomUUID();
        sqlite
          .prepare(
            `INSERT INTO bulk_import_jobs (id, store_id, uploaded_by, file_name, total_rows, inserted_rows, failed_rows, errors_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            jobId,
            storeId,
            req.auth!.userId,
            bodyParsed.data.fileName,
            bodyParsed.data.rows.length,
            insertedRows,
            errors.length,
            JSON.stringify(errors.slice(0, 50)),
            now
          );

        logAudit(req, 'BULK_MEDICINE_IMPORT', 'BulkImportJob', jobId, {
          fileName: bodyParsed.data.fileName,
          insertedRows,
          failedRows: errors.length,
        });
      });

      res.status(201).json({
        ok: true,
        totalRows: bodyParsed.data.rows.length,
        insertedCount: insertedRows,
        failedCount: errors.length,
        errors,
      });
    }
  );

  // =========================================================================
  // 2. SUPPLIERS & PURCHASE ORDERS & GRN & PAYMENTS
  // =========================================================================
  router.get('/suppliers', (req: AuthenticatedRequest, res) => {
    const suppliers = sqlite
      .prepare(
        `SELECT s.*,
                COALESCE((SELECT SUM(po.subtotal_paise - po.paid_paise) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.store_id = ? AND po.status != 'CANCELLED'), 0) as outstanding_paise,
                (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.store_id = ?) as po_count
         FROM suppliers s
         WHERE s.business_id = ?
         ORDER BY s.name ASC`
      )
      .all(req.auth!.storeId, req.auth!.storeId, req.auth!.businessId);
    res.json({ suppliers });
  });

  router.post(
    '/suppliers',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.INVENTORY_MANAGER]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(120),
          contactName: z.string().trim().max(100).optional(),
          phone: z.string().trim().min(8).max(20),
          email: z.string().trim().email().optional().or(z.literal('')),
          gstin: z.string().trim().max(30).optional(),
          drugLicense: z.string().trim().max(60).optional(),
          address: z.string().trim().max(240).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid supplier name and phone required' });
        return;
      }
      const d = parsed.data;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `INSERT INTO suppliers (id, business_id, name, contact_name, phone, email, gstin, drug_license, address, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          req.auth!.businessId,
          d.name,
          d.contactName || null,
          d.phone,
          d.email || null,
          d.gstin || null,
          d.drugLicense || null,
          d.address || null,
          now,
          now
        );
      logAudit(req, 'SUPPLIER_CREATED', 'Supplier', id, { name: d.name });
      res.status(201).json({ ok: true, id });
    }
  );

  router.patch(
    '/suppliers/:id',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.INVENTORY_MANAGER]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(120),
          contactName: z.string().trim().max(100).optional().nullable(),
          phone: z.string().trim().min(8).max(20),
          email: z.string().trim().email().optional().nullable().or(z.literal('')),
          gstin: z.string().trim().max(30).optional().nullable(),
          drugLicense: z.string().trim().max(60).optional().nullable(),
          address: z.string().trim().max(240).optional().nullable(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid supplier fields' });
        return;
      }
      const d = parsed.data;
      sqlite
        .prepare(
          `UPDATE suppliers
           SET name = ?, contact_name = ?, phone = ?, email = ?, gstin = ?, drug_license = ?, address = ?, updated_at = ?
           WHERE id = ? AND business_id = ?`
        )
        .run(
          d.name,
          d.contactName || null,
          d.phone,
          d.email || null,
          d.gstin || null,
          d.drugLicense || null,
          d.address || null,
          new Date().toISOString(),
          req.params.id,
          req.auth!.businessId
        );
      res.json({ ok: true });
    }
  );

  router.get('/purchase-orders', (req: AuthenticatedRequest, res) => {
    const storeId = req.auth!.storeId;
    const pos = sqlite
      .prepare(
        `SELECT po.*, s.name as supplier_name, s.phone as supplier_phone
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         WHERE po.store_id = ?
         ORDER BY po.created_at DESC`
      )
      .all(storeId) as Array<Record<string, unknown>>;

    const items = sqlite
      .prepare(
        `SELECT poi.*, m.name as medicine_name, m.sku, m.pack_size
         FROM purchase_order_items poi
         JOIN medicines m ON m.id = poi.medicine_id
         WHERE poi.purchase_order_id IN (SELECT id FROM purchase_orders WHERE store_id = ?)`
      )
      .all(storeId) as Array<Record<string, unknown>>;

    const payments = sqlite
      .prepare(
        `SELECT sp.*, s.name as supplier_name
         FROM supplier_payments sp
         JOIN suppliers s ON s.id = sp.supplier_id
         WHERE sp.purchase_order_id IN (SELECT id FROM purchase_orders WHERE store_id = ?)
         ORDER BY sp.paid_at DESC`
      )
      .all(storeId);

    res.json({
      purchaseOrders: pos.map((po) => ({
        ...po,
        items: items.filter((it) => it.purchase_order_id === po.id),
      })),
      supplierPayments: payments,
    });
  });

  router.post(
    '/purchase-orders',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.INVENTORY_MANAGER]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          supplierId: z.string().min(1),
          expectedDate: z.string().optional().nullable(),
          notes: z.string().max(400).optional().nullable(),
          items: z
            .array(
              z.object({
                medicineId: z.string().min(1),
                quantityOrdered: z.number().int().min(1),
                unitCostPaise: z.number().int().min(100),
                mrpPaise: z.number().int().min(100).optional(),
              })
            )
            .min(1),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Supplier and at least one purchase item required' });
        return;
      }

      const d = parsed.data;
      const subtotalPaise = d.items.reduce((s, it) => s + it.quantityOrdered * it.unitCostPaise, 0);
      const poId = crypto.randomUUID();
      const poNumber = `PO-SLM-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
      const now = new Date().toISOString();

      databaseService.withTransaction(() => {
        sqlite
          .prepare(
            `INSERT INTO purchase_orders (
              id, store_id, supplier_id, po_number, status, expected_date, subtotal_paise,
              paid_paise, payment_status, notes, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'UNPAID', ?, ?, ?, ?)`
          )
          .run(
            poId,
            req.auth!.storeId,
            d.supplierId,
            poNumber,
            PurchaseOrderStatus.ORDERED,
            d.expectedDate || null,
            subtotalPaise,
            d.notes || null,
            req.auth!.userId,
            now,
            now
          );

        for (const it of d.items) {
          sqlite
            .prepare(
              `INSERT INTO purchase_order_items (
                id, purchase_order_id, medicine_id, quantity_ordered, quantity_received, unit_cost_paise, mrp_paise
              ) VALUES (?, ?, ?, ?, 0, ?, ?)`
            )
            .run(crypto.randomUUID(), poId, it.medicineId, it.quantityOrdered, it.unitCostPaise, it.mrpPaise ?? null);
        }

        logAudit(req, 'PURCHASE_ORDER_CREATED', 'PurchaseOrder', poId, { poNumber, subtotalPaise });
      });

      res.status(201).json({ ok: true, id: poId, poNumber });
    }
  );

  router.post(
    '/purchase-orders/:id/invoice',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.INVENTORY_MANAGER]),
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Invoice file is required' });
        return;
      }
      const saved = await storageService.saveFile({
        folder: 'invoices',
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      sqlite
        .prepare('UPDATE purchase_orders SET invoice_url = ?, updated_at = ? WHERE id = ? AND store_id = ?')
        .run(saved.publicUrl, new Date().toISOString(), req.params.id, req.auth!.storeId);
      res.json({ ok: true, invoiceUrl: saved.publicUrl });
    }
  );

  router.post(
    '/purchase-orders/:id/receive',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.INVENTORY_MANAGER]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          items: z
            .array(
              z.object({
                poItemId: z.string().min(1),
                quantityReceived: z.number().int().min(1),
                batchNumber: z.string().trim().min(2).max(40),
                mfgDate: z.string().optional().nullable(),
                expiryDate: z.string().min(8),
                mrpPaise: z.number().int().min(100),
                storageConditions: z.string().max(120).optional().nullable(),
              })
            )
            .min(1),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid GRN batch receipt details required' });
        return;
      }

      const po = sqlite
        .prepare('SELECT id, po_number, supplier_id, store_id FROM purchase_orders WHERE id = ? AND store_id = ?')
        .get(req.params.id, req.auth!.storeId) as
        | { id: string; po_number: string; supplier_id: string; store_id: string }
        | undefined;
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }

      const now = new Date().toISOString();
      databaseService.withTransaction(() => {
        for (const rcv of parsed.data.items) {
          const poItem = sqlite
            .prepare('SELECT * FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?')
            .get(rcv.poItemId, po.id) as
            | { id: string; medicine_id: string; unit_cost_paise: number; quantity_received: number }
            | undefined;
          if (!poItem) continue;

          sqlite
            .prepare(
              `UPDATE purchase_order_items
               SET quantity_received = quantity_received + ?, batch_number = ?, mfg_date = ?, expiry_date = ?, mrp_paise = ?
               WHERE id = ?`
            )
            .run(rcv.quantityReceived, rcv.batchNumber, rcv.mfgDate || null, rcv.expiryDate, rcv.mrpPaise, poItem.id);

          const existingBatch = sqlite
            .prepare('SELECT id FROM medicine_batches WHERE store_id = ? AND medicine_id = ? AND batch_number = ?')
            .get(po.store_id, poItem.medicine_id, rcv.batchNumber) as { id: string } | undefined;

          let batchId = existingBatch?.id;
          if (batchId) {
            sqlite
              .prepare(
                `UPDATE medicine_batches
                 SET quantity_received = quantity_received + ?, quantity_available = quantity_available + ?,
                     purchase_price_paise = ?, mrp_paise = ?, mfg_date = COALESCE(?, mfg_date),
                     expiry_date = ?, storage_conditions = COALESCE(?, storage_conditions), updated_at = ?
                 WHERE id = ?`
              )
              .run(
                rcv.quantityReceived,
                rcv.quantityReceived,
                poItem.unit_cost_paise,
                rcv.mrpPaise,
                rcv.mfgDate || null,
                rcv.expiryDate,
                rcv.storageConditions || null,
                now,
                batchId
              );
          } else {
            batchId = crypto.randomUUID();
            sqlite
              .prepare(
                `INSERT INTO medicine_batches (
                  id, store_id, medicine_id, supplier_id, batch_number, mfg_date, expiry_date,
                  quantity_received, quantity_available, purchase_price_paise, mrp_paise,
                  storage_conditions, is_demo_data, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
              )
              .run(
                batchId,
                po.store_id,
                poItem.medicine_id,
                po.supplier_id,
                rcv.batchNumber,
                rcv.mfgDate || null,
                rcv.expiryDate,
                rcv.quantityReceived,
                rcv.quantityReceived,
                poItem.unit_cost_paise,
                rcv.mrpPaise,
                rcv.storageConditions || 'Store below 25°C',
                now,
                now
              );
          }

          sqlite
            .prepare(
              `INSERT INTO inventory_transactions (
                id, store_id, batch_id, txn_type, quantity_delta, reference_type, reference_id, notes, performed_by_id, created_at
              ) VALUES (?, ?, ?, 'PURCHASE_RECEIPT', ?, 'GRN', ?, ?, ?, ?)`
            )
            .run(
              crypto.randomUUID(),
              po.store_id,
              batchId,
              rcv.quantityReceived,
              po.po_number,
              `GRN against ${po.po_number}`,
              req.auth!.userId,
              now
            );
        }

        const pendingRow = sqlite
          .prepare(
            'SELECT COUNT(*) as c FROM purchase_order_items WHERE purchase_order_id = ? AND quantity_received < quantity_ordered'
          )
          .get(po.id) as { c: number };
        const nextPoStatus = pendingRow.c === 0 ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED;
        sqlite
          .prepare('UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?')
          .run(nextPoStatus, now, po.id);

        logAudit(req, 'GRN_RECEIVED', 'PurchaseOrder', po.id, { poNumber: po.po_number, status: nextPoStatus });
      });

      res.json({ ok: true });
    }
  );

  router.post(
    '/purchase-orders/:id/pay',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          amountPaise: z.number().int().min(100),
          method: z.enum(['NEFT', 'RTGS', 'UPI', 'CHEQUE', 'CASH']),
          reference: z.string().trim().max(80).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid supplier payment amount and method required' });
        return;
      }

      const po = sqlite
        .prepare('SELECT id, supplier_id, po_number, subtotal_paise, paid_paise FROM purchase_orders WHERE id = ? AND store_id = ?')
        .get(req.params.id, req.auth!.storeId) as
        | { id: string; supplier_id: string; po_number: string; subtotal_paise: number; paid_paise: number }
        | undefined;
      if (!po) {
        res.status(404).json({ error: 'Purchase order not found' });
        return;
      }

      const now = new Date().toISOString();
      const nextPaid = po.paid_paise + parsed.data.amountPaise;
      const payStatus = nextPaid >= po.subtotal_paise ? 'PAID' : 'PARTIAL';

      databaseService.withTransaction(() => {
        sqlite
          .prepare(
            `INSERT INTO supplier_payments (id, purchase_order_id, supplier_id, amount_paise, method, reference, paid_by, paid_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            po.id,
            po.supplier_id,
            parsed.data.amountPaise,
            parsed.data.method,
            parsed.data.reference || null,
            req.auth!.userId,
            now
          );

        sqlite
          .prepare('UPDATE purchase_orders SET paid_paise = ?, payment_status = ?, updated_at = ? WHERE id = ?')
          .run(nextPaid, payStatus, now, po.id);

        logAudit(req, 'SUPPLIER_PAYMENT_RECORDED', 'PurchaseOrder', po.id, {
          poNumber: po.po_number,
          amountPaise: parsed.data.amountPaise,
          method: parsed.data.method,
        });
      });

      res.json({ ok: true });
    }
  );

  // =========================================================================
  // 3. CUSTOMERS & STRICT CLINICAL RX ACCESS CONTROL
  // =========================================================================
  router.get('/customers', (req: AuthenticatedRequest, res) => {
    const rows = sqlite
      .prepare(
        `SELECT u.id, u.full_name, u.email, u.phone, u.is_email_verified, u.created_at,
                cp.loyalty_points, cp.allergies_note, cp.chronic_conditions,
                COUNT(o.id) as order_count,
                COALESCE(SUM(CASE WHEN o.status != 'CANCELLED' THEN o.total_paise ELSE 0 END), 0) as total_spent_paise,
                (SELECT COUNT(*) FROM support_tickets st WHERE st.user_id = u.id) as ticket_count
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'CUSTOMER'
         LEFT JOIN customer_profiles cp ON cp.user_id = u.id
         LEFT JOIN orders o ON o.user_id = u.id
         WHERE u.business_id = ?
         GROUP BY u.id
         ORDER BY total_spent_paise DESC, u.created_at DESC`
      )
      .all(req.auth!.businessId);
    res.json({ customers: rows });
  });

  router.get('/customers/:id', (req: AuthenticatedRequest, res) => {
    const customer = sqlite
      .prepare(
        `SELECT u.id, u.full_name, u.email, u.phone, u.is_email_verified, u.created_at,
                cp.loyalty_points, cp.allergies_note, cp.chronic_conditions
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'CUSTOMER'
         LEFT JOIN customer_profiles cp ON cp.user_id = u.id
         WHERE u.id = ? AND u.business_id = ?`
      )
      .get(req.params.id, req.auth!.businessId);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const orders = sqlite
      .prepare(
        `SELECT id, order_number, status, prescription_status, total_paise, payment_method, payment_status, created_at
         FROM orders WHERE user_id = ? AND store_id = ? ORDER BY created_at DESC`
      )
      .all(req.params.id, req.auth!.storeId);

    const tickets = sqlite
      .prepare('SELECT * FROM support_tickets WHERE user_id = ? AND store_id = ? ORDER BY created_at DESC')
      .all(req.params.id, req.auth!.storeId);

    const refunds = sqlite
      .prepare(
        `SELECT rr.*, o.order_number
         FROM refund_requests rr
         JOIN orders o ON o.id = rr.order_id
         WHERE rr.user_id = ? AND o.store_id = ?
         ORDER BY rr.created_at DESC`
      )
      .all(req.params.id, req.auth!.storeId);

    // Clinical privacy: only PHARMACIST, SUPER_ADMIN, or STORE_ADMIN can view clinical Rx records
    const canViewRx = req.auth!.roles.some((r) =>
      ([Role.PHARMACIST, Role.SUPER_ADMIN, Role.STORE_ADMIN] as Role[]).includes(r)
    );
    const prescriptions = canViewRx
      ? (
          sqlite
            .prepare(
              'SELECT id, patient_name, doctor_name, status, file_url, created_at FROM prescriptions WHERE user_id = ? AND store_id = ? ORDER BY created_at DESC'
            )
            .all(req.params.id, req.auth!.storeId) as Array<Record<string, unknown>>
        ).map((rx) => {
          const rawUrl = String(rx.file_url || '');
          const fname = rawUrl.split('/').pop() || '';
          const signedUrl = rawUrl.startsWith('/uploads/prescriptions/') ? createSignedFileUrl('prescriptions', fname) : rawUrl;
          return { ...rx, signed_file_url: signedUrl };
        })
      : [];

    res.json({
      customer,
      orders,
      tickets,
      refunds,
      prescriptions,
      rxAccessRestricted: !canViewRx,
    });
  });

  router.patch('/support-tickets/:id', (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid ticket status' });
      return;
    }
    sqlite
      .prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ? AND store_id = ?')
      .run(parsed.data.status, new Date().toISOString(), req.params.id, req.auth!.storeId);
    res.json({ ok: true });
  });

  // =========================================================================
  // 4. PAYMENTS, VERIFICATION & COD RECONCILIATION
  // =========================================================================
  router.get('/payments', (req: AuthenticatedRequest, res) => {
    const storeId = req.auth!.storeId;
    const payments = sqlite
      .prepare(
        `SELECT p.*, o.order_number, o.status as order_status, o.payment_method as order_payment_method,
                o.cod_reconciled, o.cod_reconciled_at, u.full_name as customer_name,
                du.full_name as partner_name,
                (SELECT COALESCE(SUM(amount_paise), 0) FROM refunds r WHERE r.payment_id = p.id) as refunded_paise
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         JOIN users u ON u.id = o.user_id
         LEFT JOIN delivery_assignments da ON da.order_id = o.id
         LEFT JOIN delivery_partners dp ON dp.id = da.delivery_partner_id
         LEFT JOIN users du ON du.id = dp.user_id
         WHERE o.store_id = ?
         ORDER BY p.created_at DESC`
      )
      .all(storeId);

    const codSummary = sqlite
      .prepare(
        `SELECT dp.id as partner_id, du.full_name as partner_name,
                COUNT(o.id) as cod_orders,
                COALESCE(SUM(o.total_paise), 0) as total_collected_paise,
                COALESCE(SUM(CASE WHEN COALESCE(o.cod_reconciled, 0) = 1 THEN o.total_paise ELSE 0 END), 0) as settled_paise,
                COALESCE(SUM(CASE WHEN COALESCE(o.cod_reconciled, 0) = 0 THEN o.total_paise ELSE 0 END), 0) as pending_reconciliation_paise
         FROM orders o
         JOIN delivery_assignments da ON da.order_id = o.id
         JOIN delivery_partners dp ON dp.id = da.delivery_partner_id
         JOIN users du ON du.id = dp.user_id
         WHERE o.store_id = ? AND o.payment_method = 'CASH_ON_DELIVERY' AND o.status = 'DELIVERED'
         GROUP BY dp.id`
      )
      .all(storeId);

    res.json({ payments, codSummary });
  });

  router.post(
    '/payments/:id/verify',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          status: z.enum([PaymentStatus.PAID, PaymentStatus.FAILED]),
          providerReference: z.string().trim().max(100).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payment verification payload' });
        return;
      }

      const payment = sqlite
        .prepare('SELECT p.id, p.order_id, o.user_id, o.order_number, o.store_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ? AND o.store_id = ?')
        .get(req.params.id, req.auth!.storeId) as
        | { id: string; order_id: string; user_id: string; order_number: string; store_id: string }
        | undefined;
      if (!payment) {
        res.status(404).json({ error: 'Payment not found' });
        return;
      }

      const now = new Date().toISOString();
      databaseService.withTransaction(() => {
        sqlite
          .prepare('UPDATE payments SET status = ?, provider_reference = COALESCE(?, provider_reference), paid_at = ?, updated_at = ? WHERE id = ?')
          .run(
            parsed.data.status,
            parsed.data.providerReference || null,
            parsed.data.status === PaymentStatus.PAID ? now : null,
            now,
            payment.id
          );
        sqlite
          .prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?')
          .run(parsed.data.status, now, payment.order_id);

        logAudit(req, 'PAYMENT_VERIFIED', 'Payment', payment.id, { status: parsed.data.status });
      });

      if (parsed.data.status === PaymentStatus.PAID) {
        notificationService.notify({
          userId: payment.user_id,
          storeId: payment.store_id,
          template: 'PAYMENT_CONFIRMED',
          title: `Payment Verified for ${payment.order_number}`,
          message: `Payment for order ${payment.order_number} has been confirmed.`,
          metadata: { orderId: payment.order_id },
        });
      }

      res.json({ ok: true });
    }
  );

  router.post(
    '/orders/:id/reconcile-cod',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const order = sqlite
        .prepare("SELECT id, order_number, total_paise FROM orders WHERE id = ? AND store_id = ? AND payment_method = 'CASH_ON_DELIVERY'")
        .get(req.params.id, req.auth!.storeId) as { id: string; order_number: string; total_paise: number } | undefined;
      if (!order) {
        res.status(404).json({ error: 'COD order not found' });
        return;
      }

      const now = new Date().toISOString();
      databaseService.withTransaction(() => {
        sqlite
          .prepare('UPDATE orders SET cod_reconciled = 1, cod_reconciled_at = ?, cod_reconciled_by = ?, payment_status = ?, updated_at = ? WHERE id = ?')
          .run(now, req.auth!.userId, PaymentStatus.PAID, now, order.id);
        sqlite
          .prepare('UPDATE payments SET status = ?, paid_at = COALESCE(paid_at, ?), updated_at = ? WHERE order_id = ?')
          .run(PaymentStatus.PAID, now, now, order.id);

        logAudit(req, 'COD_RECONCILED', 'Order', order.id, {
          orderNumber: order.order_number,
          amountPaise: order.total_paise,
        });
      });

      res.json({ ok: true });
    }
  );

  // =========================================================================
  // 5. COUPONS & WEBSITE LEGAL POLICIES & PROMOTION IMAGES
  // =========================================================================
  router.get('/coupons', (req: AuthenticatedRequest, res) => {
    const coupons = sqlite
      .prepare('SELECT * FROM coupons WHERE business_id = ? ORDER BY created_at DESC')
      .all(req.auth!.businessId);
    res.json({ coupons });
  });

  router.post(
    '/coupons',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          code: z.string().trim().min(3).max(24).transform((s) => s.toUpperCase()),
          description: z.string().trim().min(4).max(200),
          discountType: z.enum(['PERCENT', 'FLAT']),
          discountValue: z.number().int().min(1),
          minOrderPaise: z.number().int().min(0).default(0),
          maxDiscountPaise: z.number().int().min(0).optional().nullable(),
          expiresAt: z.string().optional().nullable(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid coupon code, type, and discount value required' });
        return;
      }

      const d = parsed.data;
      const existing = sqlite.prepare('SELECT id FROM coupons WHERE upper(code) = upper(?)').get(d.code);
      if (existing) {
        res.status(409).json({ error: `Coupon code ${d.code} already exists` });
        return;
      }

      const id = crypto.randomUUID();
      sqlite
        .prepare(
          `INSERT INTO coupons (id, business_id, code, description, discount_type, discount_value, min_order_paise, max_discount_paise, is_active, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          id,
          req.auth!.businessId,
          d.code,
          d.description,
          d.discountType,
          d.discountValue,
          d.minOrderPaise,
          d.maxDiscountPaise ?? null,
          d.expiresAt || null,
          new Date().toISOString()
        );
      logAudit(req, 'COUPON_CREATED', 'Coupon', id, { code: d.code });
      res.status(201).json({ ok: true, id });
    }
  );

  router.patch(
    '/coupons/:id',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }
      sqlite
        .prepare('UPDATE coupons SET is_active = ? WHERE id = ? AND business_id = ?')
        .run(parsed.data.isActive ? 1 : 0, req.params.id, req.auth!.businessId);
      res.json({ ok: true });
    }
  );

  router.delete(
    '/coupons/:id',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      sqlite.prepare('DELETE FROM coupons WHERE id = ? AND business_id = ?').run(req.params.id, req.auth!.businessId);
      res.json({ ok: true });
    }
  );

  router.get('/policies', (req: AuthenticatedRequest, res) => {
    const policies = sqlite
      .prepare('SELECT * FROM legal_policies WHERE store_id = ? ORDER BY title ASC')
      .all(req.auth!.storeId);
    res.json({ policies });
  });

  router.put(
    '/policies/:slug',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          title: z.string().trim().min(3).max(120),
          content: z.string().trim().min(10).max(8000),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Policy title and content required' });
        return;
      }
      const now = new Date().toISOString();
      sqlite
        .prepare(
          `INSERT INTO legal_policies (id, store_id, slug, title, content, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(store_id, slug) DO UPDATE SET title = excluded.title, content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
        )
        .run(crypto.randomUUID(), req.auth!.storeId, req.params.slug, parsed.data.title, parsed.data.content, req.auth!.userId, now);
      logAudit(req, 'LEGAL_POLICY_UPDATED', 'LegalPolicy', req.params.slug, { title: parsed.data.title });
      res.json({ ok: true });
    }
  );

  router.post(
    '/promotions/:id/image',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Banner image required' });
        return;
      }
      const saved = await storageService.saveFile({
        folder: 'store',
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      sqlite
        .prepare('UPDATE store_promotions SET image_url = ? WHERE id = ? AND store_id = ?')
        .run(saved.publicUrl, req.params.id, req.auth!.storeId);
      res.json({ ok: true, imageUrl: saved.publicUrl });
    }
  );

  // =========================================================================
  // 6. ANALYTICS, REPORTS & EXPORTS (CSV + XLSX) & AUDIT LOGS
  // =========================================================================
  function buildReportDataset(storeId: string, businessId: string) {
    const byCategory = sqlite
      .prepare(
        `SELECT c.name as category_name, COALESCE(SUM(oi.line_total_paise), 0) as revenue_paise, COALESCE(SUM(oi.quantity), 0) as units_sold
         FROM categories c
         LEFT JOIN medicines m ON m.category_id = c.id
         LEFT JOIN order_items oi ON oi.medicine_id = m.id
         LEFT JOIN orders o ON o.id = oi.order_id AND o.store_id = ? AND o.status NOT IN ('CANCELLED', 'REJECTED', 'RETURNED')
         WHERE c.business_id = ?
         GROUP BY c.id
         ORDER BY revenue_paise DESC`
      )
      .all(storeId, businessId);

    const taxSummary = sqlite
      .prepare(
        `SELECT COALESCE(SUM(subtotal_paise), 0) as gross_sales_paise,
                COALESCE(SUM(tax_paise), 0) as total_gst_paise,
                COALESCE(SUM(discount_paise), 0) as total_discounts_paise,
                COALESCE(SUM(total_paise), 0) as net_revenue_paise,
                COUNT(*) as order_count
         FROM orders
         WHERE store_id = ? AND status NOT IN ('CANCELLED', 'REJECTED', 'RETURNED')`
      )
      .get(storeId);

    const inventoryValuation = sqlite
      .prepare(
        `SELECT m.name as medicine_name, m.sku, mb.batch_number, mb.expiry_date, mb.quantity_available,
                mb.purchase_price_paise, mb.mrp_paise,
                (mb.quantity_available * mb.purchase_price_paise) as cost_value_paise,
                (mb.quantity_available * mb.mrp_paise) as mrp_value_paise,
                mb.is_quarantined
         FROM medicine_batches mb
         JOIN medicines m ON m.id = mb.medicine_id
         WHERE mb.store_id = ?
         ORDER BY mb.expiry_date ASC`
      )
      .all(storeId);

    const lowAndOutStock = sqlite
      .prepare(
        `SELECT m.name as medicine_name, m.sku, m.pack_size,
                COALESCE(SUM(CASE WHEN COALESCE(mb.is_quarantined, 0) = 0 AND mb.expiry_date > date('now') THEN mb.quantity_available ELSE 0 END), 0) as sellable_stock
         FROM medicines m
         LEFT JOIN medicine_batches mb ON mb.medicine_id = m.id AND mb.store_id = ?
         WHERE m.business_id = ?
         GROUP BY m.id
         HAVING sellable_stock <= 20
         ORDER BY sellable_stock ASC`
      )
      .all(storeId, businessId);

    const expiringAndExpired = sqlite
      .prepare(
        `SELECT m.name as medicine_name, m.sku, mb.batch_number, mb.expiry_date, mb.quantity_available,
                mb.quantity_expired, mb.is_quarantined,
                CAST(julianday(mb.expiry_date) - julianday('now') AS INTEGER) as days_to_expiry
         FROM medicine_batches mb
         JOIN medicines m ON m.id = mb.medicine_id
         WHERE mb.store_id = ? AND date(mb.expiry_date) <= date('now', '+90 days')
         ORDER BY mb.expiry_date ASC`
      )
      .all(storeId);

    const cancellations = sqlite
      .prepare(
        `SELECT o.order_number, o.total_paise, o.cancellation_reason, o.updated_at, u.full_name as customer_name
         FROM orders o
         JOIN users u ON u.id = o.user_id
         WHERE o.store_id = ? AND o.status IN ('CANCELLED', 'REJECTED', 'RETURNED')
         ORDER BY o.updated_at DESC`
      )
      .all(storeId);

    const deliveryPerformance = sqlite
      .prepare(
        `SELECT u.full_name as partner_name, dp.vehicle_number,
                COUNT(CASE WHEN da.status = 'DELIVERED' THEN 1 END) as delivered_count,
                COUNT(CASE WHEN da.status IN ('DELIVERY_FAILED', 'FAILED') THEN 1 END) as failed_count,
                ROUND(AVG(CASE WHEN da.delivered_at IS NOT NULL THEN (julianday(da.delivered_at) - julianday(da.assigned_at)) * 1440 END), 1) as avg_delivery_mins
         FROM delivery_partners dp
         JOIN users u ON u.id = dp.user_id
         LEFT JOIN delivery_assignments da ON da.delivery_partner_id = dp.id
         WHERE dp.store_id = ?
         GROUP BY dp.id`
      )
      .all(storeId);

    const paymentReconciliation = sqlite
      .prepare(
        `SELECT o.payment_method, p.status as payment_status, COUNT(*) as txn_count,
                COALESCE(SUM(p.amount_paise), 0) as total_paise,
                COALESCE(SUM(CASE WHEN o.payment_method = 'CASH_ON_DELIVERY' AND COALESCE(o.cod_reconciled, 0) = 1 THEN p.amount_paise ELSE 0 END), 0) as cod_settled_paise
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE o.store_id = ?
         GROUP BY o.payment_method, p.status`
      )
      .all(storeId);

    const productPerformance = sqlite
      .prepare(
        `SELECT m.name as medicine_name, m.sku, COALESCE(SUM(oi.quantity), 0) as units_sold,
                COALESCE(SUM(oi.line_total_paise), 0) as revenue_paise
         FROM medicines m
         LEFT JOIN order_items oi ON oi.medicine_id = m.id
         LEFT JOIN orders o ON o.id = oi.order_id AND o.store_id = ? AND o.status NOT IN ('CANCELLED', 'REJECTED', 'RETURNED')
         WHERE m.business_id = ?
         GROUP BY m.id
         ORDER BY revenue_paise DESC, units_sold DESC
         LIMIT 20`
      )
      .all(storeId, businessId);

    return {
      byCategory,
      taxSummary,
      inventoryValuation,
      lowAndOutStock,
      expiringAndExpired,
      cancellations,
      deliveryPerformance,
      paymentReconciliation,
      productPerformance,
    };
  }

  router.get('/reports', (req: AuthenticatedRequest, res) => {
    const dataset = buildReportDataset(req.auth!.storeId, req.auth!.businessId);
    const auditLogs = sqlite
      .prepare(
        `SELECT al.*, u.full_name as actor_name
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
         WHERE al.business_id = ?
         ORDER BY al.created_at DESC
         LIMIT 40`
      )
      .all(req.auth!.businessId);

    res.json({ ...dataset, auditLogs });
  });

  router.get('/reports/export', (req: AuthenticatedRequest, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : 'sales';
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const dataset = buildReportDataset(req.auth!.storeId, req.auth!.businessId);

    let rows: Array<Record<string, unknown>> = [];
    if (type === 'inventory_valuation') rows = dataset.inventoryValuation as Array<Record<string, unknown>>;
    else if (type === 'low_stock') rows = dataset.lowAndOutStock as Array<Record<string, unknown>>;
    else if (type === 'expiring_stock') rows = dataset.expiringAndExpired as Array<Record<string, unknown>>;
    else if (type === 'cancellations') rows = dataset.cancellations as Array<Record<string, unknown>>;
    else if (type === 'delivery_performance') rows = dataset.deliveryPerformance as Array<Record<string, unknown>>;
    else if (type === 'payment_reconciliation') rows = dataset.paymentReconciliation as Array<Record<string, unknown>>;
    else if (type === 'product_performance') rows = dataset.productPerformance as Array<Record<string, unknown>>;
    else rows = dataset.byCategory as Array<Record<string, unknown>>;

    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ message: 'No rows for selected report' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, type.slice(0, 30));

    if (format === 'xlsx') {
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="shree_leela_${type}_report.xlsx"`);
      res.send(buf);
      return;
    }

    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shree_leela_${type}_report.csv"`);
    res.send(csv);
  });

  router.get('/audit-logs', (req: AuthenticatedRequest, res) => {
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType.trim() : '';

    let query = `
      SELECT al.id, al.action, al.entity_type, al.entity_id, al.metadata_json, al.created_at,
             u.full_name as actor_name, u.email as actor_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.actor_user_id
      WHERE al.business_id = ?
    `;
    const params: Array<string> = [req.auth!.businessId];
    if (action) {
      query += ' AND al.action LIKE ?';
      params.push(`%${action}%`);
    }
    if (entityType) {
      query += ' AND al.entity_type = ?';
      params.push(entityType);
    }
    query += ' ORDER BY al.created_at DESC LIMIT 150';

    const logs = sqlite.prepare(query).all(...params);

    const staff = sqlite
      .prepare(
        `SELECT u.id, u.full_name, u.email, u.phone, u.is_active, ep.employee_code, ep.designation, ep.pharmacist_reg_number,
                GROUP_CONCAT(ur.role, ', ') as roles
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN employee_profiles ep ON ep.user_id = u.id
         WHERE u.business_id = ? AND ur.role IN ('SUPER_ADMIN', 'STORE_ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER')
         GROUP BY u.id
         ORDER BY u.full_name ASC`
      )
      .all(req.auth!.businessId);

    res.json({ logs, staff });
  });

  return router;
}
