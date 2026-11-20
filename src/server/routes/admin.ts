import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { sqlite, databaseService, backupDatabase } from '../db/sqlite-db.ts';
import { authService, requireRoles, type AuthenticatedRequest } from '../services/auth-service.ts';
import { storageService } from '../services/storage-service.ts';
import { realtimeService } from '../services/realtime-service.ts';
import { mapsAdapter } from '../services/maps-adapter.ts';
import { getPublicStoreInfo } from './public-customer.ts';
import { createAdminErpRouter } from './admin-erp.ts';
import { orderLifecycleService, OrderLifecycleError } from '../services/order-lifecycle-service.ts';
import { notificationService } from '../services/notification-service.ts';
import { createSignedFileUrl, malwareScannerService, sanitizeTextInput } from '../services/security-service.ts';
import {
  getOnboardingState,
  isScheduleBlockedOnline,
  signOffOnboardingLaunch,
  updateOnboardingProgress,
} from '../services/onboarding-compliance-service.ts';
import {
  DeliveryAssignmentStatus,
  OrderStatus,
  PaymentStatus,
  PrescriptionStatus,
  PublicationStatus,
  Role,
} from '../../shared/types.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

const STAFF_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.STORE_ADMIN,
  Role.PHARMACIST,
  Role.INVENTORY_MANAGER,
];

function writeAudit(
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
      meta ? JSON.stringify(meta) : null,
      new Date().toISOString()
    );
}

function getDateWindow(range: string, fromParam?: string, toParam?: string): { startIso: string; endIso: string } {
  const now = new Date();
  const end = toParam ? new Date(`${toParam}T23:59:59.999Z`) : now;
  if (range === 'custom' && fromParam) {
    const start = new Date(`${fromParam}T00:00:00.000Z`);
    return {
      startIso: Number.isNaN(start.getTime()) ? new Date(now.getTime() - 7 * 86400000).toISOString() : start.toISOString(),
      endIso: Number.isNaN(end.getTime()) ? now.toISOString() : end.toISOString(),
    };
  }
  const days = range === 'daily' ? 1 : range === 'monthly' ? 30 : 7;
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  start.setUTCHours(0, 0, 0, 0);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function createAdminRouter(): Router {
  const router = Router();
  router.use(requireRoles(STAFF_ROLES));

  // Mount ERP subrouter first so static paths (/medicines/export, /medicines/import, etc.) match before /:id routes
  router.use(createAdminErpRouter());

  // =========================================================================
  // 1. OVERVIEW DASHBOARD (13 REAL DB KPIs + CHARTS + DATE RANGES)
  // =========================================================================
  router.get('/overview', (req: AuthenticatedRequest, res) => {
    const storeId = req.auth!.storeId;
    const businessId = req.auth!.businessId;
    const range = typeof req.query.range === 'string' ? req.query.range : 'weekly';
    const fromParam = typeof req.query.from === 'string' ? req.query.from : undefined;
    const toParam = typeof req.query.to === 'string' ? req.query.to : undefined;
    const { startIso, endIso } = getDateWindow(range, fromParam, toParam);

    const todayRow = sqlite
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'REJECTED', 'RETURNED') THEN total_paise ELSE 0 END), 0) as todays_revenue,
                COUNT(*) as todays_orders
         FROM orders
         WHERE store_id = ? AND date(created_at) = date('now')`
      )
      .get(storeId) as { todays_revenue: number; todays_orders: number };

    const statusCounts = sqlite
      .prepare(
        `SELECT
           COUNT(*) as total_orders,
           COUNT(CASE WHEN status IN ('ORDER_RECEIVED', 'PAYMENT_PENDING', 'AWAITING_CUSTOMER_ACCEPTANCE', 'CONFIRMED') THEN 1 END) as pending_orders,
           COUNT(CASE WHEN status IN ('PREPARING', 'PACKED') THEN 1 END) as preparing_orders,
           COUNT(CASE WHEN status IN ('READY_FOR_DISPATCH', 'DRIVER_ASSIGNED', 'OUT_FOR_DELIVERY') THEN 1 END) as active_deliveries,
           COUNT(CASE WHEN status IN ('DELIVERED', 'COLLECTED') THEN 1 END) as completed_orders,
           COUNT(CASE WHEN status IN ('CANCELLED', 'REJECTED', 'RETURNED') THEN 1 END) as cancelled_orders,
           COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'REJECTED', 'RETURNED') THEN total_paise ELSE 0 END), 0) as gross_revenue
         FROM orders WHERE store_id = ?`
      )
      .get(storeId) as Record<string, number>;

    const pendingRx = sqlite
      .prepare("SELECT COUNT(*) as c FROM prescriptions WHERE store_id = ? AND status IN ('PENDING_REVIEW', 'CLARIFICATION_NEEDED')")
      .get(storeId) as { c: number };

    const totalCustomers = sqlite
      .prepare(
        `SELECT COUNT(DISTINCT u.id) as c
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'CUSTOMER'
         WHERE u.business_id = ?`
      )
      .get(businessId) as { c: number };

    const availablePartners = sqlite
      .prepare(
        `SELECT COUNT(*) as c
         FROM delivery_partners
         WHERE store_id = ? AND is_available = 1 AND is_on_shift = 1 AND COALESCE(account_status, 'ACTIVE') = 'ACTIVE'`
      )
      .get(storeId) as { c: number };

    const medStockSummary = sqlite
      .prepare(
        `SELECT m.id,
                COALESCE(SUM(CASE WHEN COALESCE(mb.is_quarantined, 0) = 0 AND mb.expiry_date > date('now') THEN mb.quantity_available ELSE 0 END), 0) as stock
         FROM medicines m
         LEFT JOIN medicine_batches mb ON mb.medicine_id = m.id AND mb.store_id = ?
         WHERE m.business_id = ? AND COALESCE(m.publication_status, 'PUBLISHED') != 'ARCHIVED'
         GROUP BY m.id`
      )
      .all(storeId, businessId) as Array<{ id: string; stock: number }>;

    const lowStockMedicines = medStockSummary.filter((m) => m.stock > 0 && m.stock <= 20).length;
    const outOfStockMedicines = medStockSummary.filter((m) => m.stock <= 0).length;

    const expiringInventory = sqlite
      .prepare(
        `SELECT COUNT(*) as c
         FROM medicine_batches
         WHERE store_id = ? AND quantity_available > 0 AND date(expiry_date) <= date('now', '+90 days')`
      )
      .get(storeId) as { c: number };

    const rangeTotals = sqlite
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'REJECTED', 'RETURNED') THEN total_paise ELSE 0 END), 0) as revenue_paise,
                COUNT(*) as order_count
         FROM orders
         WHERE store_id = ? AND created_at >= ? AND created_at <= ?`
      )
      .get(storeId, startIso, endIso) as { revenue_paise: number; order_count: number };

    const revenueSeries = sqlite
      .prepare(
        `SELECT date(created_at) as day,
                COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'REJECTED', 'RETURNED') THEN total_paise ELSE 0 END), 0) as revenue_paise,
                COUNT(*) as order_count
         FROM orders
         WHERE store_id = ? AND created_at >= ? AND created_at <= ?
         GROUP BY date(created_at)
         ORDER BY day ASC`
      )
      .all(storeId, startIso, endIso);

    const paymentBreakdown = sqlite
      .prepare(
        `SELECT payment_method, COUNT(*) as order_count,
                COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'REJECTED', 'RETURNED') THEN total_paise ELSE 0 END), 0) as total_paise
         FROM orders
         WHERE store_id = ? AND created_at >= ? AND created_at <= ?
         GROUP BY payment_method`
      )
      .all(storeId, startIso, endIso);

    const topProducts = sqlite
      .prepare(
        `SELECT oi.medicine_id, oi.medicine_name, SUM(oi.quantity) as units_sold, SUM(oi.line_total_paise) as revenue_paise
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.store_id = ? AND o.status NOT IN ('CANCELLED', 'REJECTED', 'RETURNED') AND o.created_at >= ? AND o.created_at <= ?
         GROUP BY oi.medicine_id, oi.medicine_name
         ORDER BY revenue_paise DESC
         LIMIT 6`
      )
      .all(storeId, startIso, endIso);

    const lowStockBatches = sqlite
      .prepare(
        `SELECT mb.id, mb.batch_number, mb.quantity_available, mb.expiry_date, m.name as medicine_name, m.sku
         FROM medicine_batches mb
         JOIN medicines m ON m.id = mb.medicine_id
         WHERE mb.store_id = ? AND mb.quantity_available <= 20
         ORDER BY mb.quantity_available ASC
         LIMIT 8`
      )
      .all(storeId);

    const recentOrders = sqlite
      .prepare(
        `SELECT o.id, o.order_number, o.status, o.prescription_status, o.total_paise, o.payment_method, o.payment_status, o.created_at,
                u.full_name as customer_name, u.phone as customer_phone
         FROM orders o
         JOIN users u ON u.id = o.user_id
         WHERE o.store_id = ?
         ORDER BY o.created_at DESC
         LIMIT 8`
      )
      .all(storeId);

    const recentActivity = sqlite
      .prepare(
        `SELECT al.id, al.action, al.entity_type, al.entity_id, al.created_at, u.full_name as actor_name
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
         WHERE al.business_id = ?
         ORDER BY al.created_at DESC
         LIMIT 10`
      )
      .all(businessId);

    res.json({
      range,
      window: { startIso, endIso },
      kpis: {
        todaysRevenuePaise: todayRow.todays_revenue,
        todaysOrders: todayRow.todays_orders,
        pendingOrders: statusCounts.pending_orders,
        awaitingRxApproval: pendingRx.c,
        ordersBeingPrepared: statusCounts.preparing_orders,
        activeDeliveries: statusCounts.active_deliveries,
        completedOrders: statusCounts.completed_orders,
        cancelledOrders: statusCounts.cancelled_orders,
        totalCustomers: totalCustomers.c,
        availableDeliveryPartners: availablePartners.c,
        lowStockMedicines,
        outOfStockMedicines,
        expiringInventoryCount: expiringInventory.c,
        totalOrders: statusCounts.total_orders,
        pendingPrescriptions: pendingRx.c,
        grossRevenuePaise: statusCounts.gross_revenue,
        rangeRevenuePaise: rangeTotals.revenue_paise,
        rangeOrdersCount: rangeTotals.order_count,
      },
      revenueSeries,
      paymentBreakdown,
      topProducts,
      lowStockBatches,
      recentOrders,
      recentActivity,
    });
  });

  // =========================================================================
  // 2. ORDER MANAGEMENT (11 TABS + DETAIL DRAWER + REASON ENFORCEMENT)
  // =========================================================================
  router.get('/orders', (req: AuthenticatedRequest, res) => {
    const storeId = req.auth!.storeId;
    const orders = sqlite
      .prepare(
        `SELECT o.*, u.full_name as customer_name, u.phone as customer_phone, u.email as customer_email,
                a.line1 as address_line1, a.city as address_city, a.postal_code,
                da.delivery_partner_id, da.status as delivery_status,
                du.full_name as partner_name,
                p.id as prescription_id, p.quoted_amount_paise, p.quotation_accepted as rx_quotation_accepted,
                (SELECT status FROM refund_requests rr WHERE rr.order_id = o.id ORDER BY rr.created_at DESC LIMIT 1) as refund_request_status
         FROM orders o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN addresses a ON a.id = o.address_id
         LEFT JOIN delivery_assignments da ON da.order_id = o.id
         LEFT JOIN delivery_partners dp ON dp.id = da.delivery_partner_id
         LEFT JOIN users du ON du.id = dp.user_id
         LEFT JOIN prescriptions p ON p.order_id = o.id
         WHERE o.store_id = ?
         ORDER BY o.created_at DESC`
      )
      .all(storeId) as Array<Record<string, unknown>>;

    const items = sqlite
      .prepare(
        `SELECT oi.*, mb.batch_number, mb.expiry_date
         FROM order_items oi
         LEFT JOIN medicine_batches mb ON mb.id = oi.batch_id
         WHERE oi.order_id IN (SELECT id FROM orders WHERE store_id = ?)`
      )
      .all(storeId) as Array<Record<string, unknown>>;

    res.json({
      orders: orders.map((o) => ({
        ...o,
        items: items.filter((i) => i.order_id === o.id),
      })),
    });
  });

  router.get('/orders/:id', (req: AuthenticatedRequest, res) => {
    const storeId = req.auth!.storeId;
    const order = sqlite
      .prepare(
        `SELECT o.*, u.full_name as customer_name, u.phone as customer_phone, u.email as customer_email,
                a.recipient_name, a.phone as delivery_phone, a.line1 as address_line1, a.line2 as address_line2,
                a.landmark, a.city as address_city, a.state as address_state, a.postal_code,
                da.id as assignment_id, da.delivery_partner_id, da.status as delivery_status, da.assigned_at, da.picked_up_at, da.delivered_at,
                du.full_name as partner_name, du.phone as partner_phone, dp.vehicle_number,
                i.invoice_number, i.issued_at as invoice_issued_at
         FROM orders o
         JOIN users u ON u.id = o.user_id
         LEFT JOIN addresses a ON a.id = o.address_id
         LEFT JOIN delivery_assignments da ON da.order_id = o.id
         LEFT JOIN delivery_partners dp ON dp.id = da.delivery_partner_id
         LEFT JOIN users du ON du.id = dp.user_id
         LEFT JOIN invoices i ON i.order_id = o.id
         WHERE o.id = ? AND o.store_id = ?`
      )
      .get(req.params.id, storeId) as Record<string, unknown> | undefined;

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const items = sqlite
      .prepare(
        `SELECT oi.*, mb.batch_number, mb.expiry_date
         FROM order_items oi
         LEFT JOIN medicine_batches mb ON mb.id = oi.batch_id
         WHERE oi.order_id = ?`
      )
      .all(order.id as string);

    const history = sqlite
      .prepare(
        `SELECT osh.*, u.full_name as changed_by_name
         FROM order_status_history osh
         LEFT JOIN users u ON u.id = osh.changed_by_id
         WHERE osh.order_id = ?
         ORDER BY osh.created_at ASC`
      )
      .all(order.id as string);

    const payment = sqlite.prepare('SELECT * FROM payments WHERE order_id = ? LIMIT 1').get(order.id as string);
    const refundRequests = sqlite
      .prepare('SELECT * FROM refund_requests WHERE order_id = ? ORDER BY created_at DESC')
      .all(order.id as string);

    const prescription = sqlite
      .prepare(
        `SELECT p.*,
                (SELECT remarks FROM prescription_reviews WHERE prescription_id = p.id ORDER BY created_at DESC LIMIT 1) as pharmacist_remarks,
                (SELECT u.full_name FROM prescription_reviews pr JOIN users u ON u.id = pr.pharmacist_id WHERE pr.prescription_id = p.id ORDER BY pr.created_at DESC LIMIT 1) as reviewed_by_name
         FROM prescriptions p
         WHERE p.order_id = ?
         ORDER BY p.created_at DESC
         LIMIT 1`
      )
      .get(order.id as string);

    res.json({
      order,
      items,
      history,
      payment: payment || null,
      refundRequests,
      prescription: prescription || null,
      store: getPublicStoreInfo(),
    });
  });

  router.patch('/orders/:id/notes', (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ internalNotes: z.string().max(800) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid notes' });
      return;
    }
    sqlite
      .prepare('UPDATE orders SET internal_notes = ?, updated_at = ? WHERE id = ? AND store_id = ?')
      .run(parsed.data.internalNotes, new Date().toISOString(), req.params.id, req.auth!.storeId);
    writeAudit(req, 'ORDER_NOTES_UPDATED', 'Order', req.params.id);
    res.json({ ok: true });
  });

  router.patch('/orders/:id/status', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        status: z.nativeEnum(OrderStatus),
        note: z.string().trim().max(300).optional(),
        reason: z.string().trim().max(300).optional(),
        override: z.boolean().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid order status' });
      return;
    }

    const reasonText = sanitizeTextInput(parsed.data.reason || parsed.data.note || '', 300);

    try {
      const result = orderLifecycleService.transition({
        orderId: req.params.id,
        storeId: req.auth!.storeId,
        nextStatus: parsed.data.status,
        actorUserId: req.auth!.userId,
        actorRoles: req.auth!.roles,
        reason: reasonText || undefined,
        isManualOverride: Boolean(parsed.data.override || reasonText.length >= 3),
      });

      writeAudit(req, 'ORDER_STATUS_UPDATED', 'Order', req.params.id, {
        fromStatus: result.previousStatus,
        toStatus: result.currentStatus,
        reason: reasonText || undefined,
      });

      res.json({ ok: true, status: result.currentStatus });
    } catch (err) {
      if (err instanceof OrderLifecycleError) {
        res.status(err.httpStatus).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  });

  router.post('/orders/:id/assign', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        deliveryPartnerId: z.string().min(1),
        priority: z.enum(['NORMAL', 'URGENT']).optional().default('NORMAL'),
        pickupTimeTarget: z.string().max(40).optional().nullable(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Delivery partner is required' });
      return;
    }

    const storeId = req.auth!.storeId;
    const store = getPublicStoreInfo();
    const order = sqlite
      .prepare(
        `SELECT o.id, o.user_id, o.order_number, o.prescription_status, a.latitude as dest_lat, a.longitude as dest_lng
         FROM orders o
         LEFT JOIN addresses a ON a.id = o.address_id
         WHERE o.id = ? AND o.store_id = ?`
      )
      .get(req.params.id, storeId) as
      | { id: string; user_id: string; order_number: string; prescription_status: string; dest_lat: number | null; dest_lng: number | null }
      | undefined;

    const partner = sqlite
      .prepare("SELECT dp.id, dp.user_id, dp.account_status, u.full_name FROM delivery_partners dp JOIN users u ON u.id = dp.user_id WHERE dp.id = ? AND dp.store_id = ?")
      .get(parsed.data.deliveryPartnerId, storeId) as
      | { id: string; user_id: string; account_status: string; full_name: string }
      | undefined;

    if (!order || !partner) {
      res.status(404).json({ error: 'Order or delivery partner not found' });
      return;
    }
    if (partner.account_status === 'SUSPENDED') {
      res.status(400).json({ error: 'Cannot assign to a suspended delivery partner' });
      return;
    }
    if (order.prescription_status !== PrescriptionStatus.NOT_REQUIRED && order.prescription_status !== PrescriptionStatus.APPROVED) {
      res.status(403).json({ error: 'Prescription must be approved by a pharmacist before dispatching.' });
      return;
    }

    const estDistKm =
      order.dest_lat && order.dest_lng
        ? mapsAdapter.computeDistanceKm(
            { lat: store.latitude, lng: store.longitude },
            { lat: Number(order.dest_lat), lng: Number(order.dest_lng) }
          )
        : null;

    const now = new Date().toISOString();
    const pickupTarget = parsed.data.pickupTimeTarget || new Date(Date.now() + 15 * 60 * 1000).toISOString();
    let previousPartnerId: string | null = null;

    databaseService.withTransaction(() => {
      const existing = sqlite
        .prepare('SELECT id, delivery_partner_id FROM delivery_assignments WHERE order_id = ?')
        .get(order.id) as { id: string; delivery_partner_id: string } | undefined;

      if (existing) {
        previousPartnerId = existing.delivery_partner_id !== partner.id ? existing.delivery_partner_id : null;
        sqlite
          .prepare(
            `UPDATE delivery_assignments
             SET delivery_partner_id = ?, status = ?, priority = ?, estimated_distance_km = ?, pickup_time_target = ?,
                 assigned_at = ?, accepted_at = NULL, rejection_reason = NULL, failure_reason = NULL, updated_at = ?
             WHERE id = ?`
          )
          .run(
            partner.id,
            DeliveryAssignmentStatus.ASSIGNED,
            parsed.data.priority,
            estDistKm,
            pickupTarget,
            now,
            now,
            existing.id
          );
      } else {
        sqlite
          .prepare(
            `INSERT INTO delivery_assignments (
              id, store_id, order_id, delivery_partner_id, status, priority, estimated_distance_km, pickup_time_target, assigned_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            storeId,
            order.id,
            partner.id,
            DeliveryAssignmentStatus.ASSIGNED,
            parsed.data.priority,
            estDistKm,
            pickupTarget,
            now,
            now
          );
      }

      sqlite
        .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
        .run(OrderStatus.DRIVER_ASSIGNED, now, order.id);

      sqlite
        .prepare('INSERT INTO order_status_history (id, order_id, status, note, changed_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          crypto.randomUUID(),
          order.id,
          OrderStatus.DRIVER_ASSIGNED,
          `${previousPartnerId ? 'Reassigned' : 'Assigned'} to ${partner.full_name} (${parsed.data.priority})`,
          req.auth!.userId,
          now
        );

      writeAudit(req, previousPartnerId ? 'DELIVERY_PARTNER_REASSIGNED' : 'DELIVERY_PARTNER_ASSIGNED', 'Order', order.id, {
        orderNumber: order.order_number,
        partnerName: partner.full_name,
        priority: parsed.data.priority,
      });
    });

    notificationService.notify({
      userId: partner.user_id,
      storeId,
      template: 'DRIVER_ASSIGNED',
      title: `New Delivery Assignment: ${order.order_number}`,
      message: `Order ${order.order_number} (${parsed.data.priority}) ready at pharmacy counter. Accept or reject from your Assignments tab.`,
      metadata: { orderId: order.id, orderNumber: order.order_number },
    });
    notificationService.notify({
      userId: order.user_id,
      storeId,
      template: 'DRIVER_ASSIGNED',
      title: `Delivery Partner Assigned for ${order.order_number}`,
      message: `${partner.full_name} has been assigned to deliver your order ${order.order_number}.`,
      metadata: { orderId: order.id, orderNumber: order.order_number },
    });

    const payload = {
      orderId: order.id,
      orderNumber: order.order_number,
      status: OrderStatus.DRIVER_ASSIGNED,
      deliveryStatus: DeliveryAssignmentStatus.ASSIGNED,
      deliveryPartnerId: partner.id,
      priority: parsed.data.priority,
    };
    realtimeService.emitOrderUpdate(order.id, storeId, payload, partner.id);
    realtimeService.emitEvent({
      event: 'delivery.assigned',
      orderId: order.id,
      storeId,
      partnerId: partner.id,
      payload,
    });
    if (previousPartnerId) {
      realtimeService.emitEvent({
        event: 'order.status.updated',
        orderId: order.id,
        storeId,
        partnerId: previousPartnerId,
        payload: { orderId: order.id, reassignedAway: true },
      });
    }

    res.json({ ok: true });
  });

  router.post('/orders/:id/regenerate-otp', (req: AuthenticatedRequest, res) => {
    const order = sqlite
      .prepare('SELECT id, order_number, user_id FROM orders WHERE id = ? AND store_id = ?')
      .get(req.params.id, req.auth!.storeId) as { id: string; order_number: string; user_id: string } | undefined;
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const newOtp = String(Math.floor(1000 + Math.random() * 9000));
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    sqlite
      .prepare('UPDATE orders SET delivery_otp = ?, delivery_otp_expires_at = ?, delivery_otp_attempts = 0, delivery_otp_locked_until = NULL, updated_at = ? WHERE id = ?')
      .run(newOtp, expiresAt, now, order.id);
    writeAudit(req, 'DELIVERY_OTP_REGENERATED', 'Order', order.id);
    res.json({ ok: true, expiresAt });
  });

  router.post('/assignments/:orderId/resolve-exception', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        action: z.enum(['MARK_RETURNED', 'REOPEN_FOR_DISPATCH', 'CANCEL_ORDER']),
        note: z.string().trim().min(3).max(300),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid exception action and reason note required' });
      return;
    }

    const storeId = req.auth!.storeId;
    const row = sqlite
      .prepare(
        `SELECT da.id as assignment_id, da.order_id, da.delivery_partner_id, da.status, o.order_number
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         WHERE da.order_id = ? AND da.store_id = ?`
      )
      .get(req.params.orderId, storeId) as
      | { assignment_id: string; order_id: string; delivery_partner_id: string; status: string; order_number: string }
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Delivery assignment not found' });
      return;
    }

    const now = new Date().toISOString();
    databaseService.withTransaction(() => {
      const targetOrderStatus =
        parsed.data.action === 'MARK_RETURNED'
          ? OrderStatus.RETURNED
          : parsed.data.action === 'CANCEL_ORDER'
            ? OrderStatus.CANCELLED
            : OrderStatus.READY_FOR_DISPATCH;

      if (parsed.data.action === 'MARK_RETURNED') {
        sqlite
          .prepare('UPDATE delivery_assignments SET status = ?, returned_at = COALESCE(returned_at, ?), failure_reason = COALESCE(failure_reason, ?), updated_at = ? WHERE id = ?')
          .run(DeliveryAssignmentStatus.RETURNED, now, parsed.data.note, now, row.assignment_id);
        sqlite
          .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
          .run(OrderStatus.RETURNED, now, row.order_id);
      } else if (parsed.data.action === 'REOPEN_FOR_DISPATCH') {
        sqlite.prepare('DELETE FROM delivery_assignments WHERE id = ?').run(row.assignment_id);
        sqlite
          .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
          .run(OrderStatus.READY_FOR_DISPATCH, now, row.order_id);
      } else {
        sqlite
          .prepare('UPDATE delivery_assignments SET status = ?, failure_reason = ?, updated_at = ? WHERE id = ?')
          .run(DeliveryAssignmentStatus.CANCELLED, parsed.data.note, now, row.assignment_id);
        sqlite
          .prepare('UPDATE orders SET status = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?')
          .run(OrderStatus.CANCELLED, parsed.data.note, now, row.order_id);
      }

      sqlite
        .prepare('INSERT INTO order_status_history (id, order_id, status, note, changed_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          crypto.randomUUID(),
          row.order_id,
          targetOrderStatus,
          `Admin exception resolved (${parsed.data.action}): ${parsed.data.note}`,
          req.auth!.userId,
          now
        );

      writeAudit(req, 'DELIVERY_EXCEPTION_RESOLVED', 'Order', row.order_id, parsed.data);
    });

    realtimeService.emitOrderUpdate(
      row.order_id,
      storeId,
      { orderId: row.order_id, exceptionResolved: parsed.data.action },
      row.delivery_partner_id
    );
    res.json({ ok: true });
  });

  // =========================================================================
  // 3. BATCH INVENTORY, QUARANTINE & FEFO ALERTS
  // =========================================================================
  router.get('/inventory', (req: AuthenticatedRequest, res) => {
    const storeId = req.auth!.storeId;
    const batches = sqlite
      .prepare(
        `SELECT mb.*, m.name as medicine_name, m.sku, m.pack_size, s.name as supplier_name,
                CAST(julianday(mb.expiry_date) - julianday('now') AS INTEGER) as days_to_expiry
         FROM medicine_batches mb
         JOIN medicines m ON m.id = mb.medicine_id
         LEFT JOIN suppliers s ON s.id = mb.supplier_id
         WHERE mb.store_id = ?
         ORDER BY mb.expiry_date ASC`
      )
      .all(storeId) as Array<Record<string, unknown>>;

    const medicines = sqlite
      .prepare('SELECT id, name, sku, pack_size, mrp_paise FROM medicines WHERE business_id = ? ORDER BY name ASC')
      .all(req.auth!.businessId);
    const suppliers = sqlite
      .prepare('SELECT id, name FROM suppliers WHERE business_id = ? ORDER BY name ASC')
      .all(req.auth!.businessId);

    const transactions = sqlite
      .prepare(
        `SELECT it.*, mb.batch_number, m.name as medicine_name, u.full_name as performed_by_name
         FROM inventory_transactions it
         JOIN medicine_batches mb ON mb.id = it.batch_id
         JOIN medicines m ON m.id = mb.medicine_id
         LEFT JOIN users u ON u.id = it.performed_by_id
         WHERE it.store_id = ?
         ORDER BY it.created_at DESC
         LIMIT 60`
      )
      .all(storeId);

    const alerts = {
      outOfStock: batches.filter((b) => Number(b.quantity_available) === 0).length,
      lowStock: batches.filter((b) => Number(b.quantity_available) > 0 && Number(b.quantity_available) <= 20).length,
      expired: batches.filter((b) => Number(b.days_to_expiry) <= 0 && Number(b.quantity_available) > 0).length,
      expiring30: batches.filter((b) => Number(b.days_to_expiry) > 0 && Number(b.days_to_expiry) <= 30 && Number(b.quantity_available) > 0).length,
      expiring60: batches.filter((b) => Number(b.days_to_expiry) > 30 && Number(b.days_to_expiry) <= 60 && Number(b.quantity_available) > 0).length,
      expiring90: batches.filter((b) => Number(b.days_to_expiry) > 60 && Number(b.days_to_expiry) <= 90 && Number(b.quantity_available) > 0).length,
      quarantined: batches.filter((b) => Boolean(b.is_quarantined)).length,
    };

    const valuation = batches.reduce<{ costPaise: number; mrpPaise: number }>(
      (acc, b) => ({
        costPaise: acc.costPaise + Number(b.quantity_available) * Number(b.purchase_price_paise),
        mrpPaise: acc.mrpPaise + Number(b.quantity_available) * Number(b.mrp_paise),
      }),
      { costPaise: 0, mrpPaise: 0 }
    );

    res.json({ batches, medicines, suppliers, transactions, alerts, valuation });
  });

  router.post(
    '/inventory/batches',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.INVENTORY_MANAGER, Role.PHARMACIST]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          medicineId: z.string().min(1),
          supplierId: z.string().optional().nullable(),
          batchNumber: z.string().trim().min(2).max(40),
          mfgDate: z.string().optional().nullable(),
          expiryDate: z.string().min(8),
          purchasePricePaise: z.number().int().min(0),
          mrpPaise: z.number().int().min(100),
          quantityReceived: z.number().int().min(1),
          storageConditions: z.string().trim().max(120).optional().nullable(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid batch details required' });
        return;
      }

      const d = parsed.data;
      const storeId = req.auth!.storeId;
      const now = new Date().toISOString();
      const batchId = crypto.randomUUID();

      try {
        databaseService.withTransaction(() => {
          sqlite
            .prepare(
              `INSERT INTO medicine_batches (
                id, store_id, medicine_id, supplier_id, batch_number, mfg_date, expiry_date,
                quantity_received, quantity_available, purchase_price_paise, mrp_paise, storage_conditions,
                is_demo_data, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
            )
            .run(
              batchId,
              storeId,
              d.medicineId,
              d.supplierId || null,
              d.batchNumber,
              d.mfgDate || null,
              d.expiryDate,
              d.quantityReceived,
              d.quantityReceived,
              d.purchasePricePaise,
              d.mrpPaise,
              d.storageConditions || 'Store below 25°C',
              now,
              now
            );

          sqlite
            .prepare(
              `INSERT INTO inventory_transactions (
                id, store_id, batch_id, txn_type, quantity_delta, reference_type, notes, performed_by_id, created_at
              ) VALUES (?, ?, ?, 'PURCHASE_RECEIPT', ?, 'BATCH_CREATE', ?, ?, ?)`
            )
            .run(
              crypto.randomUUID(),
              storeId,
              batchId,
              d.quantityReceived,
              `New batch ${d.batchNumber} received`,
              req.auth!.userId,
              now
            );

          writeAudit(req, 'BATCH_CREATED', 'MedicineBatch', batchId, { batchNumber: d.batchNumber, qty: d.quantityReceived });
        });
        res.status(201).json({ ok: true, id: batchId });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unable to add batch';
        res.status(400).json({ error: msg.includes('UNIQUE') ? 'Batch number already exists for this medicine' : msg });
      }
    }
  );

  router.patch(
    '/inventory/batches/:id/quarantine',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.PHARMACIST, Role.INVENTORY_MANAGER]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          isQuarantined: z.boolean(),
          reason: z.string().trim().min(3).max(240),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'A mandatory reason (min 3 chars) is required to quarantine/release stock' });
        return;
      }

      const now = new Date().toISOString();
      sqlite
        .prepare('UPDATE medicine_batches SET is_quarantined = ?, quarantine_reason = ?, updated_at = ? WHERE id = ? AND store_id = ?')
        .run(
          parsed.data.isQuarantined ? 1 : 0,
          parsed.data.reason,
          now,
          req.params.id,
          req.auth!.storeId
        );

      writeAudit(req, parsed.data.isQuarantined ? 'BATCH_QUARANTINED' : 'BATCH_QUARANTINE_RELEASED', 'MedicineBatch', req.params.id, {
        reason: parsed.data.reason,
      });
      res.json({ ok: true });
    }
  );

  router.post('/inventory/adjust', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        batchId: z.string().min(1),
        quantityDelta: z.number().int().refine((n) => n !== 0),
        txnType: z.enum([
          'PURCHASE_RECEIPT',
          'RETURN_RESTOCK',
          'EXPIRED_WRITEOFF',
          'DAMAGED_WRITEOFF',
          'MANUAL_ADJUSTMENT',
        ]),
        notes: z.string().trim().min(3).max(240),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Quantity delta and mandatory reason (min 3 characters) required' });
      return;
    }

    const storeId = req.auth!.storeId;
    const batch = sqlite
      .prepare('SELECT id, quantity_available, quantity_damaged, quantity_expired FROM medicine_batches WHERE id = ? AND store_id = ?')
      .get(parsed.data.batchId, storeId) as
      | { id: string; quantity_available: number; quantity_damaged: number; quantity_expired: number }
      | undefined;

    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const nextQty = batch.quantity_available + parsed.data.quantityDelta;
    if (nextQty < 0) {
      res.status(400).json({ error: 'Adjustment would result in negative batch stock' });
      return;
    }

    const damagedAdd = parsed.data.txnType === 'DAMAGED_WRITEOFF' && parsed.data.quantityDelta < 0 ? Math.abs(parsed.data.quantityDelta) : 0;
    const expiredAdd = parsed.data.txnType === 'EXPIRED_WRITEOFF' && parsed.data.quantityDelta < 0 ? Math.abs(parsed.data.quantityDelta) : 0;

    const now = new Date().toISOString();
    databaseService.withTransaction(() => {
      sqlite
        .prepare(
          `UPDATE medicine_batches
           SET quantity_available = ?,
               quantity_damaged = quantity_damaged + ?,
               quantity_expired = quantity_expired + ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(nextQty, damagedAdd, expiredAdd, now, batch.id);

      sqlite
        .prepare(
          `INSERT INTO inventory_transactions (id, store_id, batch_id, txn_type, quantity_delta, reference_type, notes, performed_by_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          storeId,
          batch.id,
          parsed.data.txnType,
          parsed.data.quantityDelta,
          'ADMIN_ADJUSTMENT',
          parsed.data.notes,
          req.auth!.userId,
          now
        );

      writeAudit(req, 'INVENTORY_ADJUSTED', 'MedicineBatch', batch.id, {
        txnType: parsed.data.txnType,
        quantityDelta: parsed.data.quantityDelta,
        reason: parsed.data.notes,
      });
    });

    if (nextQty <= 15) {
      const admins = sqlite
        .prepare("SELECT user_id FROM user_roles WHERE store_id = ? AND role IN ('STORE_ADMIN', 'INVENTORY_MANAGER', 'SUPER_ADMIN') LIMIT 3")
        .all(storeId) as Array<{ user_id: string }>;
      for (const a of admins) {
        notificationService.notify({
          userId: a.user_id,
          storeId,
          template: 'LOW_INVENTORY_ALERT',
          title: 'Low Inventory Alert',
          message: `Batch ${batch.id} stock dropped to ${nextQty} units (${parsed.data.txnType}).`,
        });
      }
    }

    res.json({ ok: true, quantityAvailable: nextQty });
  });

  // =========================================================================
  // 4. MEDICINES MANAGEMENT (24 FIELDS, DRAFTS, DUPLICATE, ARCHIVE, MULTI-IMAGE)
  // =========================================================================
  router.get('/medicines', (req: AuthenticatedRequest, res) => {
    const storeId = req.auth!.storeId;
    const rows = sqlite
      .prepare(
        `SELECT m.*, c.name as category_name, sc.name as subcategory_name, mf.name as manufacturer_name,
                COALESCE(m.publication_status, 'PUBLISHED') as publication_status,
                COALESCE((SELECT SUM(quantity_available) FROM medicine_batches WHERE medicine_id = m.id AND store_id = ? AND COALESCE(is_quarantined, 0) = 0 AND expiry_date > date('now')), 0) as total_stock,
                COALESCE((SELECT SUM(quantity_reserved) FROM medicine_batches WHERE medicine_id = m.id AND store_id = ?), 0) as reserved_stock
         FROM medicines m
         JOIN categories c ON c.id = m.category_id
         LEFT JOIN subcategories sc ON sc.id = m.subcategory_id
         JOIN manufacturers mf ON mf.id = m.manufacturer_id
         WHERE m.business_id = ?
         ORDER BY m.created_at DESC`
      )
      .all(storeId, storeId, req.auth!.businessId) as Array<Record<string, unknown>>;

    const images = sqlite
      .prepare('SELECT id, medicine_id, image_url, alt_text, is_primary, sort_order FROM medicine_images ORDER BY sort_order ASC')
      .all() as Array<Record<string, unknown>>;

    const manufacturers = sqlite
      .prepare('SELECT id, name FROM manufacturers WHERE business_id = ? ORDER BY name ASC')
      .all(req.auth!.businessId);

    res.json({
      medicines: rows.map((m) => ({
        ...m,
        images: images.filter((im) => im.medicine_id === m.id),
      })),
      manufacturers,
    });
  });

  router.post('/medicines', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(140),
        genericName: z.string().trim().min(2).max(140),
        brand: z.string().trim().max(80).optional().nullable(),
        strength: z.string().trim().max(60).optional().nullable(),
        barcode: z.string().trim().max(40).optional().nullable(),
        sku: z.string().trim().max(40).optional().nullable(),
        hsnCode: z.string().trim().max(30).optional().nullable(),
        gstPercent: z.number().int().min(0).max(28).optional().default(12),
        composition: z.string().trim().min(2).max(200),
        categoryId: z.string().min(1),
        subcategoryId: z.string().optional().nullable(),
        manufacturerId: z.string().optional().nullable(),
        manufacturerName: z.string().trim().max(120).optional().nullable(),
        dosageForm: z.string().trim().min(2).max(60),
        packSize: z.string().trim().min(2).max(60),
        scheduleType: z.enum(['OTC', 'Schedule H', 'Schedule H1', 'Schedule X', 'Narcotic', 'Psychotropic']),
        requiresPrescription: z.boolean(),
        onlineSaleRestricted: z.boolean().optional().default(false),
        usageSummary: z.string().trim().max(1000).optional().nullable(),
        storageInstructions: z.string().trim().max(240).optional().nullable(),
        mrpPaise: z.number().int().min(100),
        salePricePaise: z.number().int().min(100),
        initialStock: z.number().int().min(0).default(25),
        batchNumber: z.string().trim().min(2).max(40).default('NEW-BATCH-01'),
        mfgDate: z.string().optional().nullable(),
        expiryDate: z.string().min(8).default('2028-06-30'),
        publicationStatus: z.enum([PublicationStatus.DRAFT, PublicationStatus.PUBLISHED]).optional().default(PublicationStatus.DRAFT),
        isFeatured: z.boolean().optional().default(false),
        isEssential: z.boolean().optional().default(false),
        isPharmacistApproved: z.boolean().optional().default(false),
        isDemoData: z.boolean().optional().default(false),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid medicine data', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const isPharmacistOrSuper = req.auth!.roles.includes(Role.PHARMACIST) || req.auth!.roles.includes(Role.SUPER_ADMIN);
    // Staff drafts remain DRAFT & unapproved unless created/approved by a Pharmacist or Super Admin
    const approvedFlag = isPharmacistOrSuper && d.isPharmacistApproved ? 1 : 0;
    const pubStatus = approvedFlag === 1 && d.publicationStatus === PublicationStatus.PUBLISHED
      ? PublicationStatus.PUBLISHED
      : PublicationStatus.DRAFT;

    const scheduleRestricted = isScheduleBlockedOnline(d.scheduleType);
    const effectiveOnlineRestricted = Boolean(d.onlineSaleRestricted || scheduleRestricted);
    const effectiveRequiresRx = Boolean(d.requiresPrescription || d.scheduleType !== 'OTC');

    const medId = crypto.randomUUID();
    const slug = `${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;
    const sku = (d.sku && d.sku.trim()) || `SLM-${Date.now().toString().slice(-6)}`;
    const now = new Date().toISOString();

    databaseService.withTransaction(() => {
      let mfrId = d.manufacturerId || 'mfr-1';
      if (!d.manufacturerId && d.manufacturerName) {
        const found = sqlite
          .prepare('SELECT id FROM manufacturers WHERE business_id = ? AND lower(name) = lower(?)')
          .get(req.auth!.businessId, d.manufacturerName) as { id: string } | undefined;
        if (found) {
          mfrId = found.id;
        } else {
          mfrId = crypto.randomUUID();
          sqlite
            .prepare('INSERT INTO manufacturers (id, business_id, name, country, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(mfrId, req.auth!.businessId, d.manufacturerName, 'India', now, now);
        }
      }

      sqlite
        .prepare(
          `INSERT INTO medicines (
            id, business_id, category_id, subcategory_id, manufacturer_id, sku, barcode, name, slug,
            generic_name, brand, strength, composition, dosage_form, pack_size, schedule_type,
            requires_prescription, mrp_paise, sale_price_paise, gst_percent, hsn_code,
            storage_instructions, usage_summary, is_active, publication_status, is_demo_data,
            is_featured, is_essential, is_pharmacist_approved, is_recalled, online_sale_restricted,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          medId,
          req.auth!.businessId,
          d.categoryId,
          d.subcategoryId || null,
          mfrId,
          sku,
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
          effectiveRequiresRx ? 1 : 0,
          d.mrpPaise,
          d.salePricePaise,
          d.gstPercent,
          d.hsnCode || null,
          d.storageInstructions || 'Store below 25°C',
          d.usageSummary || null,
          1,
          pubStatus,
          d.isDemoData ? 1 : 0,
          d.isFeatured ? 1 : 0,
          d.isEssential ? 1 : 0,
          approvedFlag,
          0,
          effectiveOnlineRestricted ? 1 : 0,
          now,
          now
        );

      sqlite
        .prepare(
          'INSERT INTO medicine_images (id, medicine_id, image_url, alt_text, is_primary, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          crypto.randomUUID(),
          medId,
          '/src/assets/images/demo_med_tablets_1795159503038.jpg',
          `${d.name} product view`,
          1,
          0,
          now
        );

      if (d.initialStock > 0) {
        const batchId = crypto.randomUUID();
        sqlite
          .prepare(
            `INSERT INTO medicine_batches (id, store_id, medicine_id, batch_number, mfg_date, expiry_date, quantity_received, quantity_available, purchase_price_paise, mrp_paise, storage_conditions, is_demo_data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            batchId,
            req.auth!.storeId,
            medId,
            d.batchNumber,
            d.mfgDate || null,
            d.expiryDate,
            d.initialStock,
            d.initialStock,
            Math.round(d.salePricePaise * 0.72),
            d.mrpPaise,
            d.storageInstructions || 'Store below 25°C',
            d.isDemoData ? 1 : 0,
            now,
            now
          );
      }

      writeAudit(req, 'MEDICINE_CREATED', 'Medicine', medId, { name: d.name, sku, publicationStatus: pubStatus });
    });

    res.status(201).json({ ok: true, id: medId, slug, publicationStatus: pubStatus, isPharmacistApproved: Boolean(approvedFlag) });
  });

  router.patch('/medicines/:id', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(140).optional(),
        genericName: z.string().trim().min(2).max(140).optional(),
        brand: z.string().trim().max(80).optional().nullable(),
        strength: z.string().trim().max(60).optional().nullable(),
        composition: z.string().trim().min(2).max(200).optional(),
        categoryId: z.string().min(1).optional(),
        subcategoryId: z.string().optional().nullable(),
        manufacturerId: z.string().optional(),
        dosageForm: z.string().trim().max(60).optional(),
        packSize: z.string().trim().max(60).optional(),
        barcode: z.string().trim().max(40).optional().nullable(),
        hsnCode: z.string().trim().max(30).optional().nullable(),
        gstPercent: z.number().int().min(0).max(28).optional(),
        scheduleType: z.enum(['OTC', 'Schedule H', 'Schedule H1', 'Schedule X', 'Narcotic', 'Psychotropic']).optional(),
        requiresPrescription: z.boolean().optional(),
        usageSummary: z.string().trim().max(1000).optional().nullable(),
        storageInstructions: z.string().trim().max(240).optional().nullable(),
        salePricePaise: z.number().int().min(100).optional(),
        mrpPaise: z.number().int().min(100).optional(),
        isActive: z.boolean().optional(),
        publicationStatus: z.enum([PublicationStatus.DRAFT, PublicationStatus.PUBLISHED, PublicationStatus.ARCHIVED]).optional(),
        isFeatured: z.boolean().optional(),
        isEssential: z.boolean().optional(),
        isPharmacistApproved: z.boolean().optional(),
        isRecalled: z.boolean().optional(),
        onlineSaleRestricted: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid update payload' });
      return;
    }

    const existing = sqlite
      .prepare('SELECT * FROM medicines WHERE id = ? AND business_id = ?')
      .get(req.params.id, req.auth!.businessId) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Medicine not found' });
      return;
    }

    const d = parsed.data;
    const isPharmacistOrSuper = req.auth!.roles.includes(Role.PHARMACIST) || req.auth!.roles.includes(Role.SUPER_ADMIN);
    if (d.isPharmacistApproved === true && !isPharmacistOrSuper) {
      res.status(403).json({ error: 'Only a Registered Pharmacist or Super Admin can approve products for live listing.' });
      return;
    }

    const nextApproved =
      d.isPharmacistApproved !== undefined ? (d.isPharmacistApproved ? 1 : 0) : Number(existing.is_pharmacist_approved);
    const requestedPub = d.publicationStatus ?? (String(existing.publication_status || PublicationStatus.PUBLISHED) as PublicationStatus);

    if (requestedPub === PublicationStatus.PUBLISHED && nextApproved !== 1) {
      res.status(403).json({ error: 'Product must be approved by a Registered Pharmacist before publishing live.' });
      return;
    }

    const now = new Date().toISOString();
    sqlite
      .prepare(
        `UPDATE medicines
         SET name = ?, generic_name = ?, brand = ?, strength = ?, composition = ?,
             category_id = ?, subcategory_id = ?, manufacturer_id = ?, dosage_form = ?, pack_size = ?,
             barcode = ?, hsn_code = ?, gst_percent = ?, schedule_type = ?, requires_prescription = ?,
             usage_summary = ?, storage_instructions = ?, sale_price_paise = ?, mrp_paise = ?,
             is_active = ?, publication_status = ?, is_featured = ?, is_essential = ?,
             is_pharmacist_approved = ?, is_recalled = ?, online_sale_restricted = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        (d.name ?? existing.name) as string,
        (d.genericName ?? existing.generic_name) as string,
        (d.brand !== undefined ? d.brand : existing.brand) as string | null,
        (d.strength !== undefined ? d.strength : existing.strength) as string | null,
        (d.composition ?? existing.composition) as string,
        (d.categoryId ?? existing.category_id) as string,
        (d.subcategoryId !== undefined ? d.subcategoryId : existing.subcategory_id) as string | null,
        (d.manufacturerId ?? existing.manufacturer_id) as string,
        (d.dosageForm ?? existing.dosage_form) as string,
        (d.packSize ?? existing.pack_size) as string,
        (d.barcode !== undefined ? d.barcode : existing.barcode) as string | null,
        (d.hsnCode !== undefined ? d.hsnCode : existing.hsn_code) as string | null,
        Number(d.gstPercent ?? existing.gst_percent),
        (d.scheduleType ?? existing.schedule_type) as string,
        d.requiresPrescription !== undefined ? (d.requiresPrescription ? 1 : 0) : Number(existing.requires_prescription),
        (d.usageSummary !== undefined ? d.usageSummary : existing.usage_summary) as string | null,
        (d.storageInstructions !== undefined ? d.storageInstructions : existing.storage_instructions) as string | null,
        Number(d.salePricePaise ?? existing.sale_price_paise),
        Number(d.mrpPaise ?? existing.mrp_paise),
        d.isActive !== undefined ? (d.isActive ? 1 : 0) : requestedPub === PublicationStatus.ARCHIVED ? 0 : Number(existing.is_active),
        requestedPub,
        d.isFeatured !== undefined ? (d.isFeatured ? 1 : 0) : Number(existing.is_featured),
        d.isEssential !== undefined ? (d.isEssential ? 1 : 0) : Number(existing.is_essential),
        nextApproved,
        d.isRecalled !== undefined ? (d.isRecalled ? 1 : 0) : Number(existing.is_recalled),
        d.onlineSaleRestricted !== undefined ? (d.onlineSaleRestricted ? 1 : 0) : Number(existing.online_sale_restricted),
        now,
        req.params.id
      );

    writeAudit(req, 'MEDICINE_UPDATED', 'Medicine', req.params.id, {
      publicationStatus: requestedPub,
      salePricePaise: d.salePricePaise,
      isPharmacistApproved: Boolean(nextApproved),
    });

    res.json({ ok: true });
  });

  router.post('/medicines/:id/archive', (req: AuthenticatedRequest, res) => {
    sqlite
      .prepare("UPDATE medicines SET publication_status = 'ARCHIVED', is_active = 0, updated_at = ? WHERE id = ? AND business_id = ?")
      .run(new Date().toISOString(), req.params.id, req.auth!.businessId);
    writeAudit(req, 'MEDICINE_ARCHIVED', 'Medicine', req.params.id);
    res.json({ ok: true });
  });

  router.post('/medicines/:id/duplicate', (req: AuthenticatedRequest, res) => {
    const src = sqlite
      .prepare('SELECT * FROM medicines WHERE id = ? AND business_id = ?')
      .get(req.params.id, req.auth!.businessId) as Record<string, unknown> | undefined;
    if (!src) {
      res.status(404).json({ error: 'Medicine not found' });
      return;
    }

    const newId = crypto.randomUUID();
    const suffix = Date.now().toString().slice(-4);
    const newSku = `${String(src.sku)}-COPY-${suffix}`;
    const newSlug = `${String(src.slug)}-copy-${suffix}`;
    const now = new Date().toISOString();

    databaseService.withTransaction(() => {
      sqlite
        .prepare(
          `INSERT INTO medicines (
            id, business_id, category_id, subcategory_id, manufacturer_id, sku, barcode, name, slug,
            generic_name, brand, strength, composition, dosage_form, pack_size, schedule_type,
            requires_prescription, mrp_paise, sale_price_paise, gst_percent, hsn_code,
            storage_instructions, usage_summary, is_active, publication_status, is_demo_data,
            is_featured, is_essential, is_pharmacist_approved, is_recalled, online_sale_restricted,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'DRAFT', 0, 0, 0, 0, 0, ?, ?, ?)`
        )
        .run(
          newId,
          src.business_id as string,
          src.category_id as string,
          (src.subcategory_id as string) || null,
          src.manufacturer_id as string,
          newSku,
          `${String(src.name)} (Draft Copy)`,
          newSlug,
          src.generic_name as string,
          (src.brand as string) || null,
          (src.strength as string) || null,
          src.composition as string,
          src.dosage_form as string,
          src.pack_size as string,
          src.schedule_type as string,
          Number(src.requires_prescription),
          Number(src.mrp_paise),
          Number(src.sale_price_paise),
          Number(src.gst_percent),
          (src.hsn_code as string) || null,
          (src.storage_instructions as string) || null,
          (src.usage_summary as string) || null,
          Number(src.online_sale_restricted || 0),
          now,
          now
        );

      const imgs = sqlite
        .prepare('SELECT image_url, alt_text, is_primary, sort_order FROM medicine_images WHERE medicine_id = ?')
        .all(src.id as string) as Array<Record<string, unknown>>;
      for (const im of imgs) {
        sqlite
          .prepare('INSERT INTO medicine_images (id, medicine_id, image_url, alt_text, is_primary, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), newId, im.image_url as string, im.alt_text as string, Number(im.is_primary), Number(im.sort_order), now);
      }

      writeAudit(req, 'MEDICINE_DUPLICATED', 'Medicine', newId, { sourceMedicineId: src.id });
    });

    res.status(201).json({ ok: true, id: newId, sku: newSku });
  });

  router.post('/medicines/:id/images', upload.array('files', 6), async (req: AuthenticatedRequest, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'Select one or more image files to upload' });
      return;
    }

    const existingCount = sqlite
      .prepare('SELECT COUNT(*) as c FROM medicine_images WHERE medicine_id = ?')
      .get(req.params.id) as { c: number };

    const now = new Date().toISOString();
    const uploaded: Array<{ id: string; imageUrl: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const scan = await malwareScannerService.scanBuffer(f.buffer, f.mimetype, f.originalname);
      if (!scan.safe) {
        res.status(400).json({ error: scan.reason || 'Uploaded image failed security check' });
        return;
      }
      const saved = await storageService.saveFile({
        folder: 'medicines',
        originalName: f.originalname,
        mimeType: f.mimetype,
        buffer: f.buffer,
      });
      const imgId = crypto.randomUUID();
      const isPrimary = existingCount.c === 0 && i === 0 ? 1 : 0;
      sqlite
        .prepare('INSERT INTO medicine_images (id, medicine_id, image_url, alt_text, is_primary, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(imgId, req.params.id, saved.publicUrl, f.originalname, isPrimary, existingCount.c + i, now);
      uploaded.push({ id: imgId, imageUrl: saved.publicUrl });
    }

    res.status(201).json({ ok: true, images: uploaded });
  });

  router.patch('/medicines/:id/images/:imgId/primary', (req: AuthenticatedRequest, res) => {
    databaseService.withTransaction(() => {
      sqlite.prepare('UPDATE medicine_images SET is_primary = 0 WHERE medicine_id = ?').run(req.params.id);
      sqlite.prepare('UPDATE medicine_images SET is_primary = 1 WHERE id = ? AND medicine_id = ?').run(req.params.imgId, req.params.id);
    });
    res.json({ ok: true });
  });

  router.delete('/medicines/:id/images/:imgId', (req: AuthenticatedRequest, res) => {
    sqlite.prepare('DELETE FROM medicine_images WHERE id = ? AND medicine_id = ?').run(req.params.imgId, req.params.id);
    res.json({ ok: true });
  });

  // =========================================================================
  // 5. CATEGORIES & SUBCATEGORIES MANAGEMENT
  // =========================================================================
  router.get('/categories', (req: AuthenticatedRequest, res) => {
    const rows = sqlite
      .prepare(
        `SELECT c.*, COUNT(m.id) as medicine_count
         FROM categories c
         LEFT JOIN medicines m ON m.category_id = c.id
         WHERE c.business_id = ?
         GROUP BY c.id
         ORDER BY c.display_order ASC`
      )
      .all(req.auth!.businessId);
    const subcategories = sqlite.prepare('SELECT * FROM subcategories ORDER BY name ASC').all();
    res.json({ categories: rows, subcategories });
  });

  router.post('/categories', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(240).optional(),
        parentCategoryId: z.string().optional(),
        iconName: z.string().trim().max(40).optional(),
        seoDescription: z.string().trim().max(240).optional(),
        isFeatured: z.boolean().optional().default(false),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid category name required' });
      return;
    }
    const id = crypto.randomUUID();
    const slug = `${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-3)}`;
    const now = new Date().toISOString();

    if (parsed.data.parentCategoryId) {
      sqlite
        .prepare(
          'INSERT INTO subcategories (id, category_id, name, slug, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
        )
        .run(id, parsed.data.parentCategoryId, parsed.data.name, slug, parsed.data.description || null, now, now);
    } else {
      sqlite
        .prepare(
          `INSERT INTO categories (id, business_id, name, slug, description, icon_name, seo_description, is_featured, display_order, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 99, 1, ?, ?)`
        )
        .run(
          id,
          req.auth!.businessId,
          parsed.data.name,
          slug,
          parsed.data.description || null,
          parsed.data.iconName || null,
          parsed.data.seoDescription || null,
          parsed.data.isFeatured ? 1 : 0,
          now,
          now
        );
    }
    res.status(201).json({ ok: true, id, slug });
  });

  router.patch('/categories/:id', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        description: z.string().trim().max(240).optional().nullable(),
        iconName: z.string().trim().max(40).optional().nullable(),
        seoDescription: z.string().trim().max(240).optional().nullable(),
        displayOrder: z.number().int().min(0).optional(),
        isFeatured: z.boolean().optional(),
        isActive: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid category update' });
      return;
    }
    const existing = sqlite
      .prepare('SELECT * FROM categories WHERE id = ? AND business_id = ?')
      .get(req.params.id, req.auth!.businessId) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    const d = parsed.data;
    sqlite
      .prepare(
        `UPDATE categories
         SET name = ?, description = ?, icon_name = ?, seo_description = ?, display_order = ?, is_featured = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        (d.name ?? existing.name) as string,
        (d.description !== undefined ? d.description : existing.description) as string | null,
        (d.iconName !== undefined ? d.iconName : existing.icon_name) as string | null,
        (d.seoDescription !== undefined ? d.seoDescription : existing.seo_description) as string | null,
        Number(d.displayOrder ?? existing.display_order),
        d.isFeatured !== undefined ? (d.isFeatured ? 1 : 0) : Number(existing.is_featured),
        d.isActive !== undefined ? (d.isActive ? 1 : 0) : Number(existing.is_active),
        new Date().toISOString(),
        req.params.id
      );
    res.json({ ok: true });
  });

  router.patch('/subcategories/:id', (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ isActive: z.boolean(), name: z.string().trim().min(2).max(80).optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid subcategory update' });
      return;
    }
    sqlite
      .prepare('UPDATE subcategories SET is_active = ?, name = COALESCE(?, name), updated_at = ? WHERE id = ?')
      .run(parsed.data.isActive ? 1 : 0, parsed.data.name || null, new Date().toISOString(), req.params.id);
    res.json({ ok: true });
  });

  router.post('/categories/:id/banner', upload.single('file'), async (req: AuthenticatedRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Banner image file required' });
      return;
    }
    const saved = await storageService.saveFile({
      folder: 'store',
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });
    sqlite
      .prepare('UPDATE categories SET banner_url = ?, updated_at = ? WHERE id = ? AND business_id = ?')
      .run(saved.publicUrl, new Date().toISOString(), req.params.id, req.auth!.businessId);
    res.json({ ok: true, bannerUrl: saved.publicUrl });
  });

  router.post('/categories/reorder', (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ orderedIds: z.array(z.string().min(1)).min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'orderedIds array required' });
      return;
    }
    const now = new Date().toISOString();
    databaseService.withTransaction(() => {
      parsed.data.orderedIds.forEach((id, index) => {
        sqlite
          .prepare('UPDATE categories SET display_order = ?, updated_at = ? WHERE id = ? AND business_id = ?')
          .run(index + 1, now, id, req.auth!.businessId);
      });
    });
    res.json({ ok: true });
  });

  // =========================================================================
  // 6. PROMOTIONS, PIN CODES, AVAILABILITY REQUESTS, REFUNDS & TICKETS
  // =========================================================================
  router.get('/promotions', (req: AuthenticatedRequest, res) => {
    const promotions = sqlite
      .prepare('SELECT * FROM store_promotions WHERE store_id = ? ORDER BY display_order ASC')
      .all(req.auth!.storeId);
    res.json({ promotions });
  });

  router.post('/promotions', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        title: z.string().trim().min(3).max(120),
        subtitle: z.string().trim().min(4).max(240),
        ctaLabel: z.string().trim().min(2).max(40),
        ctaLink: z.string().trim().min(1).max(120),
        badgeText: z.string().trim().max(40).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid promotional banner details required' });
      return;
    }
    const id = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO store_promotions (id, store_id, title, subtitle, cta_label, cta_link, badge_text, display_order, is_active, is_demo_data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 10, 1, 0, ?)`
      )
      .run(
        id,
        req.auth!.storeId,
        parsed.data.title,
        parsed.data.subtitle,
        parsed.data.ctaLabel,
        parsed.data.ctaLink,
        parsed.data.badgeText || null,
        new Date().toISOString()
      );
    res.status(201).json({ ok: true, id });
  });

  router.patch('/promotions/:id', (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid banner update' });
      return;
    }
    sqlite
      .prepare('UPDATE store_promotions SET is_active = ? WHERE id = ? AND store_id = ?')
      .run(parsed.data.isActive ? 1 : 0, req.params.id, req.auth!.storeId);
    res.json({ ok: true });
  });

  router.delete('/promotions/:id', (req: AuthenticatedRequest, res) => {
    sqlite.prepare('DELETE FROM store_promotions WHERE id = ? AND store_id = ?').run(req.params.id, req.auth!.storeId);
    res.json({ ok: true });
  });

  router.get('/pincodes', (req: AuthenticatedRequest, res) => {
    const pincodes = sqlite
      .prepare('SELECT * FROM serviceable_pincodes WHERE store_id = ? ORDER BY pincode ASC')
      .all(req.auth!.storeId);
    res.json({ pincodes });
  });

  router.post('/pincodes', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        pincode: z.string().trim().regex(/^\d{6}$/),
        areaName: z.string().trim().min(2).max(120),
        deliveryFeePaise: z.number().int().min(0),
        estimatedMins: z.number().int().min(10).max(240),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid 6-digit PIN code and area details required' });
      return;
    }
    sqlite
      .prepare(
        `INSERT INTO serviceable_pincodes (id, store_id, pincode, area_name, delivery_fee_paise, estimated_mins, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(store_id, pincode) DO UPDATE SET area_name = excluded.area_name, delivery_fee_paise = excluded.delivery_fee_paise, estimated_mins = excluded.estimated_mins, is_active = 1`
      )
      .run(crypto.randomUUID(), req.auth!.storeId, parsed.data.pincode, parsed.data.areaName, parsed.data.deliveryFeePaise, parsed.data.estimatedMins);
    res.status(201).json({ ok: true });
  });

  router.delete('/pincodes/:id', (req: AuthenticatedRequest, res) => {
    sqlite.prepare('DELETE FROM serviceable_pincodes WHERE id = ? AND store_id = ?').run(req.params.id, req.auth!.storeId);
    res.json({ ok: true });
  });

  router.get('/availability-requests', (req: AuthenticatedRequest, res) => {
    const requests = sqlite
      .prepare('SELECT * FROM availability_requests WHERE store_id = ? ORDER BY created_at DESC')
      .all(req.auth!.storeId);
    res.json({ requests });
  });

  router.patch('/availability-requests/:id', (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ status: z.enum(['OPEN', 'CONTACTED', 'FULFILLED']) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    sqlite
      .prepare('UPDATE availability_requests SET status = ? WHERE id = ? AND store_id = ?')
      .run(parsed.data.status, req.params.id, req.auth!.storeId);
    res.json({ ok: true });
  });

  router.get('/refund-requests', (req: AuthenticatedRequest, res) => {
    const requests = sqlite
      .prepare(
        `SELECT rr.*, o.order_number, u.full_name as customer_name, u.phone as customer_phone
         FROM refund_requests rr
         JOIN orders o ON o.id = rr.order_id
         JOIN users u ON u.id = rr.user_id
         WHERE o.store_id = ?
         ORDER BY rr.created_at DESC`
      )
      .all(req.auth!.storeId);
    res.json({ requests });
  });

  router.patch('/refund-requests/:id', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({ status: z.enum(['SUBMITTED', 'APPROVED', 'PROCESSED', 'REJECTED']), adminNote: z.string().max(300).optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid refund request status' });
      return;
    }

    const rr = sqlite
      .prepare(
        `SELECT rr.id, rr.user_id, rr.order_id, o.order_number, o.store_id, o.total_paise
         FROM refund_requests rr
         JOIN orders o ON o.id = rr.order_id
         WHERE rr.id = ? AND o.store_id = ?`
      )
      .get(req.params.id, req.auth!.storeId) as
      | { id: string; user_id: string; order_id: string; order_number: string; store_id: string; total_paise: number }
      | undefined;

    if (!rr) {
      res.status(404).json({ error: 'Refund request not found' });
      return;
    }

    const now = new Date().toISOString();
    databaseService.withTransaction(() => {
      sqlite
        .prepare('UPDATE refund_requests SET status = ?, admin_note = ? WHERE id = ?')
        .run(parsed.data.status, parsed.data.adminNote || null, req.params.id);

      if (parsed.data.status === 'PROCESSED') {
        const pay = sqlite
          .prepare('SELECT id, amount_paise FROM payments WHERE order_id = ? LIMIT 1')
          .get(rr.order_id) as { id: string; amount_paise: number } | undefined;
        if (pay) {
          sqlite
            .prepare(
              `INSERT OR IGNORE INTO refunds (id, order_id, payment_id, amount_paise, reason, gateway_refund_id, processed_by_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              crypto.randomUUID(),
              rr.order_id,
              pay.id,
              pay.amount_paise,
              parsed.data.adminNote || 'Admin processed customer refund',
              `rfnd_slm_${Date.now()}`,
              req.auth!.userId,
              now
            );
          sqlite.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?').run(PaymentStatus.REFUNDED, now, pay.id);
          sqlite.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?').run(PaymentStatus.REFUNDED, now, rr.order_id);
        }
      }

      writeAudit(req, 'REFUND_REQUEST_UPDATED', 'RefundRequest', req.params.id, { status: parsed.data.status });
    });

    notificationService.notify({
      userId: rr.user_id,
      storeId: rr.store_id,
      template: 'REFUND_STATUS',
      title: `Refund ${parsed.data.status} — ${rr.order_number}`,
      message: `Your refund request for order ${rr.order_number} has been updated to ${parsed.data.status}. ${parsed.data.adminNote || ''}`.trim(),
      metadata: { orderId: rr.order_id, refundStatus: parsed.data.status },
    });

    res.json({ ok: true });
  });

  router.get('/support-tickets', (req: AuthenticatedRequest, res) => {
    const tickets = sqlite
      .prepare('SELECT * FROM support_tickets WHERE store_id = ? ORDER BY created_at DESC')
      .all(req.auth!.storeId);
    res.json({ tickets });
  });

  // =========================================================================
  // 7. RESTRICTED PHARMACIST PRESCRIPTION WORKSPACE (NEVER BYPASSABLE)
  // =========================================================================
  router.get('/prescriptions', (req: AuthenticatedRequest, res) => {
    const rows = sqlite
      .prepare(
        `SELECT p.*, u.full_name as customer_name, u.phone as customer_phone, o.order_number, o.status as order_status,
                (SELECT remarks FROM prescription_reviews WHERE prescription_id = p.id ORDER BY created_at DESC LIMIT 1) as latest_remarks,
                (SELECT ru.full_name || COALESCE(' (' || ep.pharmacist_reg_number || ')', '')
                 FROM prescription_reviews pr
                 JOIN users ru ON ru.id = pr.pharmacist_id
                 LEFT JOIN employee_profiles ep ON ep.user_id = ru.id
                 WHERE pr.prescription_id = p.id
                 ORDER BY pr.created_at DESC LIMIT 1) as reviewed_by_pharmacist,
                (SELECT created_at FROM prescription_reviews WHERE prescription_id = p.id ORDER BY created_at DESC LIMIT 1) as reviewed_at
         FROM prescriptions p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN orders o ON o.id = p.order_id
         WHERE p.store_id = ?
         ORDER BY p.created_at DESC`
      )
      .all(req.auth!.storeId) as Array<Record<string, unknown>>;

    const itemReviews = sqlite
      .prepare(
        `SELECT pir.*
         FROM prescription_item_reviews pir
         JOIN prescriptions p ON p.id = pir.prescription_id
         WHERE p.store_id = ?
         ORDER BY pir.created_at ASC`
      )
      .all(req.auth!.storeId) as Array<Record<string, unknown>>;

    const reviewHistory = sqlite
      .prepare(
        `SELECT pr.*, u.full_name as pharmacist_name, ep.pharmacist_reg_number
         FROM prescription_reviews pr
         JOIN prescriptions p ON p.id = pr.prescription_id
         JOIN users u ON u.id = pr.pharmacist_id
         LEFT JOIN employee_profiles ep ON ep.user_id = u.id
         WHERE p.store_id = ?
         ORDER BY pr.created_at DESC`
      )
      .all(req.auth!.storeId) as Array<Record<string, unknown>>;

    const canReviewRx = req.auth!.roles.some((r) => ([Role.PHARMACIST, Role.SUPER_ADMIN] as Role[]).includes(r));

    res.json({
      canReviewRx,
      prescriptions: rows.map((p) => {
        const rawUrl = String(p.file_url || '');
        const fname = rawUrl.split('/').pop() || '';
        const signedUrl = rawUrl.startsWith('/uploads/prescriptions/') ? createSignedFileUrl('prescriptions', fname) : rawUrl;
        return {
          ...p,
          signed_file_url: signedUrl,
          itemReviews: itemReviews.filter((ir) => ir.prescription_id === p.id),
          reviewHistory: reviewHistory.filter((rh) => rh.prescription_id === p.id),
        };
      }),
    });
  });

  router.post(
    '/prescriptions/:id/review',
    // Strictly restrict Rx clinical approval to Registered Pharmacists or Super Admin!
    requireRoles([Role.PHARMACIST, Role.SUPER_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          decision: z.enum([
            PrescriptionStatus.APPROVED,
            PrescriptionStatus.REJECTED,
            PrescriptionStatus.CLARIFICATION_NEEDED,
          ]),
          remarks: z.string().trim().min(2).max(400),
          quotedAmountPaise: z.number().int().min(100).optional().nullable(),
          pharmacistQuotationNotes: z.string().trim().max(400).optional().nullable(),
          items: z
            .array(
              z.object({
                medicineId: z.string().optional().nullable(),
                medicineName: z.string().trim().min(2).max(140),
                requestedQty: z.number().int().min(1),
                approvedQty: z.number().int().min(0),
                status: z.enum(['APPROVED', 'REJECTED', 'CLARIFICATION_NEEDED']),
                pharmacistNote: z.string().trim().max(200).optional().nullable(),
              })
            )
            .optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Decision and pharmacist remarks are required' });
        return;
      }

      const rx = sqlite
        .prepare('SELECT id, user_id, order_id, store_id, patient_name FROM prescriptions WHERE id = ? AND store_id = ?')
        .get(req.params.id, req.auth!.storeId) as
        | { id: string; user_id: string; order_id: string | null; store_id: string; patient_name: string }
        | undefined;
      if (!rx) {
        res.status(404).json({ error: 'Prescription not found' });
        return;
      }

      const linkedOrder = rx.order_id
        ? (sqlite
            .prepare('SELECT id, order_number, payment_method, payment_status, total_paise FROM orders WHERE id = ?')
            .get(rx.order_id) as
            | { id: string; order_number: string; payment_method: string; payment_status: string; total_paise: number }
            | undefined)
        : undefined;

      const hasNewQuote =
        parsed.data.decision === PrescriptionStatus.APPROVED &&
        parsed.data.quotedAmountPaise !== undefined &&
        parsed.data.quotedAmountPaise !== null &&
        (!linkedOrder || parsed.data.quotedAmountPaise !== linkedOrder.total_paise);

      const now = new Date().toISOString();
      databaseService.withTransaction(() => {
        sqlite
          .prepare(
            `UPDATE prescriptions
             SET status = ?,
                 quoted_amount_paise = COALESCE(?, quoted_amount_paise),
                 pharmacist_quotation_notes = COALESCE(?, pharmacist_quotation_notes),
                 clarification_notes = CASE WHEN ? = 'CLARIFICATION_NEEDED' THEN ? ELSE clarification_notes END,
                 updated_at = ?
             WHERE id = ?`
          )
          .run(
            parsed.data.decision,
            parsed.data.quotedAmountPaise ?? null,
            parsed.data.pharmacistQuotationNotes ?? null,
            parsed.data.decision,
            parsed.data.remarks,
            now,
            rx.id
          );

        sqlite
          .prepare(
            'INSERT INTO prescription_reviews (id, prescription_id, pharmacist_id, decision, remarks, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(crypto.randomUUID(), rx.id, req.auth!.userId, parsed.data.decision, parsed.data.remarks, now);

        if (parsed.data.items && parsed.data.items.length > 0) {
          sqlite.prepare('DELETE FROM prescription_item_reviews WHERE prescription_id = ?').run(rx.id);
          for (const it of parsed.data.items) {
            sqlite
              .prepare(
                `INSERT INTO prescription_item_reviews (id, prescription_id, medicine_id, medicine_name, requested_qty, approved_qty, status, pharmacist_note, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                crypto.randomUUID(),
                rx.id,
                it.medicineId || null,
                it.medicineName,
                it.requestedQty,
                it.approvedQty,
                it.status,
                it.pharmacistNote || null,
                now
              );
          }
        }

        if (linkedOrder) {
          const isOnlinePay = linkedOrder.payment_method !== 'CASH_ON_DELIVERY';
          const needsPayment = isOnlinePay && linkedOrder.payment_status !== PaymentStatus.PAID;

          const nextOrderStatus =
            parsed.data.decision === PrescriptionStatus.REJECTED
              ? OrderStatus.REJECTED
              : parsed.data.decision === PrescriptionStatus.CLARIFICATION_NEEDED
                ? OrderStatus.CLARIFICATION_REQUIRED
                : hasNewQuote
                  ? OrderStatus.AWAITING_CUSTOMER_ACCEPTANCE
                  : needsPayment
                    ? OrderStatus.PAYMENT_PENDING
                    : OrderStatus.CONFIRMED;

          sqlite
            .prepare(
              `UPDATE orders
               SET prescription_status = ?,
                   status = ?,
                   quoted_total_paise = COALESCE(?, quoted_total_paise),
                   quotation_status = CASE WHEN ? THEN 'QUOTED' ELSE quotation_status END,
                   updated_at = ?
               WHERE id = ?`
            )
            .run(
              parsed.data.decision,
              nextOrderStatus,
              parsed.data.quotedAmountPaise ?? null,
              hasNewQuote ? 1 : 0,
              now,
              linkedOrder.id
            );

          sqlite
            .prepare('INSERT INTO order_status_history (id, order_id, status, note, changed_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(crypto.randomUUID(), linkedOrder.id, nextOrderStatus, `Pharmacist: ${parsed.data.remarks}`, req.auth!.userId, now);
        }

        writeAudit(req, 'PRESCRIPTION_REVIEWED', 'Prescription', rx.id, {
          decision: parsed.data.decision,
          quotedAmountPaise: parsed.data.quotedAmountPaise ?? undefined,
        });
      });

      const template =
        parsed.data.decision === PrescriptionStatus.CLARIFICATION_NEEDED
          ? 'PRESCRIPTION_CLARIFICATION'
          : hasNewQuote
            ? 'QUOTATION_READY'
            : 'PRESCRIPTION_DECISION';

      notificationService.notify({
        userId: rx.user_id,
        storeId: rx.store_id,
        template,
        title: hasNewQuote
          ? `Quotation Ready for ${rx.patient_name}`
          : `Prescription ${parsed.data.decision.replace(/_/g, ' ')}`,
        message: hasNewQuote
          ? `Pharmacist verified prescription for ${rx.patient_name} and issued a quotation. Please review and accept in your account.`
          : `Pharmacist reviewed prescription for ${rx.patient_name}: ${parsed.data.remarks}`,
        metadata: { prescriptionId: rx.id, orderId: rx.order_id, decision: parsed.data.decision },
      });

      realtimeService.emitPrescriptionReview(rx.store_id, rx.user_id, {
        prescriptionId: rx.id,
        decision: parsed.data.decision,
      });
      if (rx.order_id) {
        realtimeService.emitOrderUpdate(rx.order_id, rx.store_id, {
          orderId: rx.order_id,
          prescriptionStatus: parsed.data.decision,
        });
      }

      res.json({ ok: true });
    }
  );

  // =========================================================================
  // 8. DELIVERY PARTNERS, STAFF ACCOUNTS & LIVE TRACKING CONTROL ROOM
  // =========================================================================
  router.get('/delivery-partners', (req: AuthenticatedRequest, res) => {
    const rows = sqlite
      .prepare(
        `SELECT dp.id, dp.user_id, dp.store_id, dp.vehicle_type, dp.vehicle_number, dp.photo_url,
                COALESCE(dp.account_status, 'ACTIVE') as account_status,
                dp.is_available, dp.is_on_shift, dp.current_lat, dp.current_lng, dp.location_accuracy_m, dp.last_location_at,
                u.full_name, u.email, u.phone,
                (SELECT COUNT(*) FROM delivery_assignments da WHERE da.delivery_partner_id = dp.id AND da.status NOT IN ('DELIVERED', 'ASSIGNMENT_REJECTED', 'RETURNED', 'CANCELLED', 'FAILED')) as active_assignments,
                (SELECT COUNT(*) FROM delivery_assignments da WHERE da.delivery_partner_id = dp.id AND da.status = 'DELIVERED') as completed_deliveries,
                (SELECT COUNT(*) FROM delivery_assignments da WHERE da.delivery_partner_id = dp.id AND da.status IN ('DELIVERY_FAILED', 'FAILED')) as failed_deliveries,
                (SELECT ROUND(AVG((julianday(da.delivered_at) - julianday(da.assigned_at)) * 1440), 1)
                 FROM delivery_assignments da WHERE da.delivery_partner_id = dp.id AND da.delivered_at IS NOT NULL) as avg_delivery_mins,
                (SELECT COALESCE(SUM(o.total_paise), 0)
                 FROM delivery_assignments da JOIN orders o ON o.id = da.order_id
                 WHERE da.delivery_partner_id = dp.id AND o.payment_method = 'CASH_ON_DELIVERY' AND o.status = 'DELIVERED' AND COALESCE(o.cod_reconciled, 0) = 0) as pending_cod_paise
         FROM delivery_partners dp
         JOIN users u ON u.id = dp.user_id
         WHERE dp.store_id = ?
         ORDER BY u.full_name ASC`
      )
      .all(req.auth!.storeId);
    res.json({ deliveryPartners: rows });
  });

  router.post(
    '/delivery-partners',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    async (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          fullName: z.string().trim().min(2).max(100),
          email: z.string().trim().email().toLowerCase(),
          phone: z.string().trim().min(10).max(16),
          password: z.string().min(8).max(128),
          vehicleType: z.string().trim().min(2).max(60),
          vehicleNumber: z.string().trim().min(4).max(30),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid delivery partner details' });
        return;
      }

      const d = parsed.data;
      const existing = sqlite
        .prepare('SELECT id FROM users WHERE lower(email) = lower(?) OR phone = ?')
        .get(d.email, d.phone);
      if (existing) {
        res.status(409).json({ error: 'User with this email or phone already exists' });
        return;
      }

      const userId = crypto.randomUUID();
      const partnerId = crypto.randomUUID();
      const hash = await authService.hashPassword(d.password);
      const now = new Date().toISOString();

      databaseService.withTransaction(() => {
        sqlite
          .prepare(
            `INSERT INTO users (id, business_id, email, phone, full_name, password_hash, is_email_verified, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(userId, req.auth!.businessId, d.email, d.phone, d.fullName, hash, 1, 1, now, now);

        sqlite
          .prepare('INSERT INTO user_roles (id, user_id, store_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), userId, req.auth!.storeId, Role.DELIVERY_PARTNER, req.auth!.userId, now);

        sqlite
          .prepare(
            `INSERT INTO delivery_partners (id, user_id, store_id, vehicle_type, vehicle_number, account_status, is_available, is_on_shift, current_lat, current_lng, last_location_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, 1, 19.2813, 72.8782, ?, ?, ?)`
          )
          .run(partnerId, userId, req.auth!.storeId, d.vehicleType, d.vehicleNumber, now, now, now);

        writeAudit(req, 'DELIVERY_PARTNER_CREATED', 'DeliveryPartner', partnerId, { fullName: d.fullName });
      });

      res.status(201).json({ ok: true, id: partnerId });
    }
  );

  router.patch(
    '/delivery-partners/:id',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          fullName: z.string().trim().min(2).max(100).optional(),
          phone: z.string().trim().min(10).max(16).optional(),
          vehicleType: z.string().trim().min(2).max(60).optional(),
          vehicleNumber: z.string().trim().min(3).max(30).optional(),
          accountStatus: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
          isAvailable: z.boolean().optional(),
          isOnShift: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid delivery partner update' });
        return;
      }

      const partner = sqlite
        .prepare('SELECT * FROM delivery_partners WHERE id = ? AND store_id = ?')
        .get(req.params.id, req.auth!.storeId) as Record<string, unknown> | undefined;
      if (!partner) {
        res.status(404).json({ error: 'Delivery partner not found' });
        return;
      }

      const d = parsed.data;
      const now = new Date().toISOString();
      databaseService.withTransaction(() => {
        if (d.fullName || d.phone) {
          sqlite
            .prepare('UPDATE users SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone), updated_at = ? WHERE id = ?')
            .run(d.fullName || null, d.phone || null, now, partner.user_id as string);
        }
        sqlite
          .prepare(
            `UPDATE delivery_partners
             SET vehicle_type = COALESCE(?, vehicle_type),
                 vehicle_number = COALESCE(?, vehicle_number),
                 account_status = COALESCE(?, account_status),
                 is_available = COALESCE(?, is_available),
                 is_on_shift = COALESCE(?, is_on_shift),
                 updated_at = ?
             WHERE id = ?`
          )
          .run(
            d.vehicleType || null,
            d.vehicleNumber || null,
            d.accountStatus || null,
            d.isAvailable !== undefined ? (d.isAvailable ? 1 : 0) : null,
            d.isOnShift !== undefined ? (d.isOnShift ? 1 : 0) : null,
            now,
            req.params.id
          );

        writeAudit(req, 'DELIVERY_PARTNER_UPDATED', 'DeliveryPartner', req.params.id, {
          accountStatus: d.accountStatus,
        });
      });

      res.json({ ok: true });
    }
  );

  router.post(
    '/delivery-partners/:id/photo',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Profile photo required' });
        return;
      }
      const saved = await storageService.saveFile({
        folder: 'partners',
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      sqlite
        .prepare('UPDATE delivery_partners SET photo_url = ?, updated_at = ? WHERE id = ? AND store_id = ?')
        .run(saved.publicUrl, new Date().toISOString(), req.params.id, req.auth!.storeId);
      res.json({ ok: true, photoUrl: saved.publicUrl });
    }
  );

  router.post(
    '/staff',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    async (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          fullName: z.string().trim().min(2).max(100),
          email: z.string().trim().email().toLowerCase(),
          phone: z.string().trim().min(10).max(16),
          password: z.string().min(8).max(128),
          role: z.enum([Role.STORE_ADMIN, Role.PHARMACIST, Role.INVENTORY_MANAGER]),
          designation: z.string().trim().min(2).max(80),
          pharmacistRegNumber: z.string().trim().max(40).optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid staff account payload' });
        return;
      }

      const d = parsed.data;
      const existing = sqlite
        .prepare('SELECT id FROM users WHERE lower(email) = lower(?) OR phone = ?')
        .get(d.email, d.phone);
      if (existing) {
        res.status(409).json({ error: 'Email or phone already in use' });
        return;
      }

      const userId = crypto.randomUUID();
      const hash = await authService.hashPassword(d.password);
      const now = new Date().toISOString();
      databaseService.withTransaction(() => {
        sqlite
          .prepare(
            `INSERT INTO users (id, business_id, email, phone, full_name, password_hash, is_email_verified, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(userId, req.auth!.businessId, d.email, d.phone, d.fullName, hash, 1, 1, now, now);

        sqlite
          .prepare('INSERT INTO user_roles (id, user_id, store_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), userId, req.auth!.storeId, d.role, req.auth!.userId, now);

        sqlite
          .prepare(
            `INSERT INTO employee_profiles (id, user_id, store_id, employee_code, designation, pharmacist_reg_number, joined_at, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            userId,
            req.auth!.storeId,
            `EMP-${Date.now().toString().slice(-4)}`,
            d.designation,
            d.pharmacistRegNumber || null,
            now,
            now,
            now
          );

        writeAudit(req, 'STAFF_PROVISIONED', 'User', userId, { role: d.role, fullName: d.fullName });
      });

      res.status(201).json({ ok: true, id: userId });
    }
  );

  // Live Delivery Control Room (Strictly tracks active shift / active delivery sessions)
  router.get('/live-tracking', async (req: AuthenticatedRequest, res) => {
    const storeId = req.auth!.storeId;
    const store = getPublicStoreInfo();
    interface PartnerQueryRow {
      id: string;
      vehicle_type: string;
      vehicle_number: string;
      is_available: number;
      is_on_shift: number;
      account_status: string;
      current_lat: number | null;
      current_lng: number | null;
      location_accuracy_m: number | null;
      last_location_at: string | null;
      full_name: string;
      phone: string;
      latest_ping_suspicious: number | null;
      latest_suspicious_reason: string | null;
    }
    interface ActiveDeliveryQueryRow {
      assignment_id: string;
      delivery_partner_id: string;
      delivery_status: string;
      priority: string;
      assigned_at: string;
      accepted_at: string | null;
      picked_up_at: string | null;
      pickup_time_target: string | null;
      failure_reason: string | null;
      rejection_reason: string | null;
      order_id: string;
      order_number: string;
      order_status: string;
      total_paise: number;
      payment_method: string;
      customer_name: string;
      customer_phone: string;
      partner_name: string;
      partner_phone: string;
      line1: string | null;
      city: string | null;
      postal_code: string | null;
      dest_lat: number | null;
      dest_lng: number | null;
    }

    const partners = sqlite
      .prepare(
        `SELECT dp.id, dp.vehicle_type, dp.vehicle_number, dp.is_available, dp.is_on_shift,
                COALESCE(dp.account_status, 'ACTIVE') as account_status,
                dp.current_lat, dp.current_lng, dp.location_accuracy_m, dp.last_location_at,
                u.full_name, u.phone,
                (SELECT is_suspicious FROM driver_locations dl WHERE dl.delivery_partner_id = dp.id ORDER BY dl.recorded_at DESC LIMIT 1) as latest_ping_suspicious,
                (SELECT suspicious_reason FROM driver_locations dl WHERE dl.delivery_partner_id = dp.id ORDER BY dl.recorded_at DESC LIMIT 1) as latest_suspicious_reason
         FROM delivery_partners dp
         JOIN users u ON u.id = dp.user_id
         WHERE dp.store_id = ? AND COALESCE(dp.account_status, 'ACTIVE') = 'ACTIVE'
         ORDER BY dp.is_on_shift DESC, u.full_name ASC`
      )
      .all(storeId) as unknown as PartnerQueryRow[];

    const activeDeliveries = sqlite
      .prepare(
        `SELECT da.id as assignment_id, da.delivery_partner_id, da.status as delivery_status, da.priority,
                da.assigned_at, da.accepted_at, da.picked_up_at, da.pickup_time_target, da.failure_reason, da.rejection_reason,
                o.id as order_id, o.order_number, o.status as order_status, o.total_paise, o.payment_method,
                u.full_name as customer_name, u.phone as customer_phone,
                du.full_name as partner_name, du.phone as partner_phone,
                a.line1, a.city, a.postal_code, a.latitude as dest_lat, a.longitude as dest_lng
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         JOIN users u ON u.id = o.user_id
         JOIN delivery_partners dp ON dp.id = da.delivery_partner_id
         JOIN users du ON du.id = dp.user_id
         LEFT JOIN addresses a ON a.id = o.address_id
         WHERE da.store_id = ? AND da.status NOT IN ('DELIVERED', 'RETURNED', 'CANCELLED', 'FAILED')
         ORDER BY CASE WHEN da.priority = 'URGENT' THEN 0 ELSE 1 END, da.assigned_at DESC`
      )
      .all(storeId) as unknown as ActiveDeliveryQueryRow[];

    const nowMs = Date.now();
    const enrichedDeliveries = activeDeliveries.map((d) => {
      const assignedMs = d.assigned_at ? new Date(String(d.assigned_at)).getTime() : nowMs;
      const elapsedMins = Math.round((nowMs - assignedMs) / 60000);
      const isDelayed =
        d.delivery_status !== 'ASSIGNMENT_REJECTED' &&
        d.delivery_status !== 'DELIVERY_FAILED' &&
        (elapsedMins > 35 ||
          (d.pickup_time_target && !d.picked_up_at && new Date(String(d.pickup_time_target)).getTime() < nowMs));
      return { ...d, elapsedMins, isDelayed: Boolean(isDelayed) };
    });

    const exceptionDeliveries = enrichedDeliveries.filter((d) =>
      ['ASSIGNMENT_REJECTED', 'DELIVERY_FAILED', 'RETURNING_TO_STORE'].includes(String(d.delivery_status))
    );

    const enrichedPartners = await Promise.all(
      partners.map(async (p) => {
        const lastLocMs = p.last_location_at ? new Date(String(p.last_location_at)).getTime() : 0;
        const ageSecs = lastLocMs ? Math.round((nowMs - lastLocMs) / 1000) : null;
        const ageMins = ageSecs !== null ? Math.round(ageSecs / 60) : null;
        const connectivity =
          !lastLocMs || ageSecs === null
            ? 'UNAVAILABLE'
            : ageSecs <= 60
              ? 'LIVE'
              : ageSecs <= 600
                ? 'STALE'
                : 'OFFLINE';

        const partnerDeliveries = enrichedDeliveries.filter(
          (d) => d.delivery_partner_id === p.id && d.delivery_status !== 'ASSIGNMENT_REJECTED'
        );
        const primary = partnerDeliveries[0] || null;
        const lat = p.current_lat ? Number(p.current_lat) : store.latitude;
        const lng = p.current_lng ? Number(p.current_lng) : store.longitude;
        const destLat = primary?.dest_lat ? Number(primary.dest_lat) : null;
        const destLng = primary?.dest_lng ? Number(primary.dest_lng) : null;

        let distanceKm: number | null = null;
        let etaMinutes: number | null = null;
        if (destLat && destLng) {
          const route = await mapsAdapter.computeRoute({ lat, lng }, { lat: destLat, lng: destLng });
          distanceKm = route.distanceKm;
          etaMinutes = route.etaMinutes;
        }

        return {
          ...p,
          connectivity,
          lastLocationAgeMins: ageMins,
          lastLocationAgeSecs: ageSecs,
          isSuspicious: Boolean(p.latest_ping_suspicious),
          suspiciousReason: (p.latest_suspicious_reason as string | null) || null,
          activeDeliveries: partnerDeliveries,
          workloadCount: partnerDeliveries.length,
          hasDelayedDelivery: partnerDeliveries.some((d) => d.isDelayed),
          primaryOrderNumber: primary ? primary.order_number : null,
          primaryOrderId: primary ? primary.order_id : null,
          distanceKm,
          etaMinutes,
        };
      })
    );

    const activePartnersOnly = enrichedPartners.filter(
      (p) => Boolean(p.is_on_shift) || (p.activeDeliveries as unknown[]).length > 0
    );

    res.json({
      store,
      partners: activePartnersOnly,
      allPartners: enrichedPartners,
      activeDeliveries: enrichedDeliveries,
      exceptionDeliveries,
      mapsConfigured: mapsAdapter.isConfigured(),
    });
  });

  // =========================================================================
  // 9. EDITABLE BUSINESS & STORE SETTINGS
  // =========================================================================
  router.get('/settings', (_req, res) => {
    res.json({ store: getPublicStoreInfo() });
  });

  router.patch(
    '/settings',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          name: z.string().trim().min(3).max(140),
          addressLine1: z.string().trim().min(4).max(200),
          landmark: z.string().trim().max(120).optional().nullable(),
          city: z.string().trim().min(2).max(80),
          state: z.string().trim().min(2).max(80),
          postalCode: z.string().trim().min(5).max(12),
          phone: z.string().trim().min(8).max(20),
          email: z.string().trim().email().optional().nullable(),
          operatingHours: z.string().trim().min(3).max(80),
          googleMapsUrl: z.string().trim().url().optional(),
          drugLicenseNumber: z.string().trim().max(80).optional().nullable(),
          gstin: z.string().trim().max(60).optional().nullable(),
          deliveryFeePaise: z.number().int().min(0),
          freeDeliveryThresholdPaise: z.number().int().min(0),
          minimumOrderPaise: z.number().int().min(0).optional().default(0),
          deliveryRadiusKm: z.number().min(1).max(50),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid settings data', issues: parsed.error.flatten() });
        return;
      }

      const d = parsed.data;
      const storeId = req.auth!.storeId;
      const now = new Date().toISOString();

      databaseService.withTransaction(() => {
        sqlite
          .prepare(
            `UPDATE stores SET name = ?, address_line1 = ?, landmark = ?, city = ?, state = ?, postal_code = ?,
             phone = ?, email = ?, operating_hours = ?, google_maps_url = ?, drug_license_number = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            d.name,
            d.addressLine1,
            d.landmark || null,
            d.city,
            d.state,
            d.postalCode,
            d.phone,
            d.email || null,
            d.operatingHours,
            d.googleMapsUrl || 'https://maps.app.goo.gl/t2GPkm2kVdTe4Cw46',
            d.drugLicenseNumber || null,
            now,
            storeId
          );

        if (d.gstin !== undefined) {
          sqlite
            .prepare('UPDATE businesses SET name = ?, gstin = ?, updated_at = ? WHERE id = ?')
            .run(d.name, d.gstin, now, req.auth!.businessId);
        }

        const kv: Array<[string, string]> = [
          ['deliveryFeePaise', String(d.deliveryFeePaise)],
          ['freeDeliveryThresholdPaise', String(d.freeDeliveryThresholdPaise)],
          ['minimumOrderPaise', String(d.minimumOrderPaise ?? 0)],
          ['deliveryRadiusKm', String(d.deliveryRadiusKm)],
        ];
        for (const [k, v] of kv) {
          sqlite
            .prepare(
              `INSERT INTO store_settings (id, store_id, key, value, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(store_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
            )
            .run(crypto.randomUUID(), storeId, k, v, now);
        }

        writeAudit(req, 'STORE_SETTINGS_UPDATED', 'Store', storeId, { name: d.name, minimumOrderPaise: d.minimumOrderPaise });
      });

      res.json({ store: getPublicStoreInfo() });
    }
  );

  router.post(
    '/settings/upload',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    upload.single('file'),
    async (req: AuthenticatedRequest, res) => {
      const kind = req.body.kind === 'logo' ? 'logo' : 'storefront';
      if (!req.file) {
        res.status(400).json({ error: 'Image file is required' });
        return;
      }
      const scan = await malwareScannerService.scanBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (!scan.safe) {
        res.status(400).json({ error: scan.reason || 'Uploaded image failed security check' });
        return;
      }
      const saved = await storageService.saveFile({
        folder: 'store',
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });

      const now = new Date().toISOString();
      if (kind === 'logo') {
        sqlite
          .prepare('UPDATE stores SET logo_url = ?, logo_placeholder = 0, updated_at = ? WHERE id = ?')
          .run(saved.publicUrl, now, req.auth!.storeId);
      } else {
        sqlite
          .prepare('UPDATE stores SET storefront_photo_url = ?, updated_at = ? WHERE id = ?')
          .run(saved.publicUrl, now, req.auth!.storeId);
      }

      res.json({ store: getPublicStoreInfo() });
    }
  );

  // =========================================================================
  // 10. STORE OWNER ONBOARDING WIZARD, PRODUCTION LAUNCH GATE & BACKUPS
  // =========================================================================
  router.get('/onboarding', (req: AuthenticatedRequest, res) => {
    const state = getOnboardingState(req.auth!.storeId);
    res.json({ onboarding: state, store: getPublicStoreInfo() });
  });

  router.patch(
    '/onboarding/step',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z
        .object({
          stepKey: z.string().min(2).max(60),
          completed: z.boolean().optional(),
          details: z
            .object({
              drugLicenseNumber: z.string().trim().max(80).optional(),
              gstin: z.string().trim().max(40).optional(),
              pharmacistName: z.string().trim().max(100).optional(),
              pharmacistRegNumber: z.string().trim().max(60).optional(),
              notes: z.string().trim().max(400).optional(),
            })
            .optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid onboarding step payload' });
        return;
      }

      const state = updateOnboardingProgress({
        storeId: req.auth!.storeId,
        businessId: req.auth!.businessId,
        userId: req.auth!.userId,
        stepKey: parsed.data.stepKey,
        completed: parsed.data.completed,
        details: parsed.data.details,
      });
      writeAudit(req, 'ONBOARDING_STEP_UPDATED', 'Store', req.auth!.storeId, {
        stepKey: parsed.data.stepKey,
      });
      res.json({ onboarding: state, store: getPublicStoreInfo() });
    }
  );

  router.post(
    '/onboarding/launch',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const parsed = z.object({ enableProductionSales: z.boolean() }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid launch payload' });
        return;
      }
      const result = signOffOnboardingLaunch({
        storeId: req.auth!.storeId,
        userId: req.auth!.userId,
        enableProductionSales: parsed.data.enableProductionSales,
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error, onboarding: result.state });
        return;
      }
      writeAudit(req, 'PRODUCTION_LAUNCH_SIGNED_OFF', 'Store', req.auth!.storeId, {
        enableProductionSales: parsed.data.enableProductionSales,
      });
      res.json({ ok: true, onboarding: result.state, store: getPublicStoreInfo() });
    }
  );

  router.post(
    '/backups/run',
    requireRoles([Role.SUPER_ADMIN, Role.STORE_ADMIN]),
    (req: AuthenticatedRequest, res) => {
      const backup = backupDatabase();
      writeAudit(req, 'DATABASE_BACKUP_CREATED', 'Database', backup.filename, {
        sizeBytes: backup.sizeBytes,
      });
      res.status(201).json({ ok: true, backup });
    }
  );

  router.get('/notifications/logs', (_req, res) => {
    const logs = sqlite
      .prepare(
        `SELECT nl.*, u.full_name as user_name, u.email as user_email
         FROM notification_logs nl
         LEFT JOIN users u ON u.id = nl.user_id
         ORDER BY nl.created_at DESC
         LIMIT 100`
      )
      .all();
    res.json({ logs });
  });

  return router;
}
