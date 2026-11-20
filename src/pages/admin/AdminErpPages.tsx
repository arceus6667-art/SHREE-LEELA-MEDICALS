import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  Download,
  Barcode,
  CheckCircle2,
  AlertTriangle,
  Truck,
  Plus,
  FileText,
  IndianRupee,
  Globe,
  ShieldCheck,
  Search,
  Trash2,
} from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout.tsx';
import { Button, Card, Input, Label, Select, Table, Textarea } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { formatIndianDateTime, formatINRPaise, Role } from '../../shared/types.ts';

// ===========================================================================
// 1. BULK INVENTORY IMPORT / EXPORT & BARCODE LOOKUP
// ===========================================================================
const IMPORT_TARGET_FIELDS = [
  { key: 'name', label: 'Product Name*', required: true },
  { key: 'genericName', label: 'Generic Name*', required: true },
  { key: 'composition', label: 'Composition*', required: true },
  { key: 'sku', label: 'SKU*', required: true },
  { key: 'mrpRupees', label: 'MRP (INR)*', required: true },
  { key: 'salePriceRupees', label: 'Sale Price (INR)*', required: true },
  { key: 'manufacturer', label: 'Manufacturer', required: false },
  { key: 'brand', label: 'Brand', required: false },
  { key: 'categorySlug', label: 'Category Slug', required: false },
  { key: 'dosageForm', label: 'Dosage Form', required: false },
  { key: 'strength', label: 'Strength', required: false },
  { key: 'packSize', label: 'Pack Size', required: false },
  { key: 'barcode', label: 'Barcode', required: false },
  { key: 'hsnCode', label: 'HSN Code', required: false },
  { key: 'gstPercent', label: 'GST %', required: false },
  { key: 'requiresPrescription', label: 'Requires Rx (YES/NO)', required: false },
  { key: 'scheduleType', label: 'Schedule (OTC / Schedule H / Schedule H1)', required: false },
  { key: 'batchNumber', label: 'Batch Number', required: false },
  { key: 'mfgDate', label: 'Mfg Date (YYYY-MM-DD)', required: false },
  { key: 'expiryDate', label: 'Expiry Date (YYYY-MM-DD)', required: false },
  { key: 'initialStock', label: 'Initial Stock', required: false },
  { key: 'purchasePriceRupees', label: 'Purchase Cost (INR)', required: false },
  { key: 'storageConditions', label: 'Storage Conditions', required: false },
] as const;

type ImportFieldKey = (typeof IMPORT_TARGET_FIELDS)[number]['key'];

const AUTO_MAP_ALIASES: Record<ImportFieldKey, string[]> = {
  name: ['name', 'product_name', 'medicine_name', 'product'],
  genericName: ['generic_name', 'genericname', 'generic'],
  composition: ['composition', 'salt', 'ingredients'],
  sku: ['sku', 'item_code', 'product_code'],
  mrpRupees: ['mrp_rupees', 'mrp_inr', 'mrp'],
  salePriceRupees: ['sale_price_rupees', 'sale_price_inr', 'sale_price', 'selling_price'],
  manufacturer: ['manufacturer', 'company', 'mfr'],
  brand: ['brand'],
  categorySlug: ['category_slug', 'category', 'category_name'],
  dosageForm: ['dosage_form', 'form'],
  strength: ['strength'],
  packSize: ['pack_size', 'pack'],
  barcode: ['barcode', 'ean', 'upc'],
  hsnCode: ['hsn_code', 'hsn'],
  gstPercent: ['gst_percent', 'gst', 'tax_rate'],
  requiresPrescription: ['requires_prescription', 'rx_required', 'rx'],
  scheduleType: ['schedule_type', 'schedule'],
  batchNumber: ['batch_number', 'batch_no', 'batch'],
  mfgDate: ['mfg_date', 'manufacturing_date'],
  expiryDate: ['expiry_date', 'exp_date', 'expiry'],
  initialStock: ['initial_stock', 'stock', 'qty', 'quantity'],
  purchasePriceRupees: ['purchase_price_rupees', 'purchase_cost', 'cost_price'],
  storageConditions: ['storage_conditions', 'storage'],
};

interface ImportJobRow {
  id: string;
  file_name: string;
  total_rows: number;
  inserted_rows: number;
  failed_rows: number;
  errors_json: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export function AdminBulkImportPage() {
  const { showToast } = useApp();
  const [fileName, setFileName] = useState<string>('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<Record<string, unknown>>>([]);
  const [columnMap, setColumnMap] = useState<Record<ImportFieldKey, string>>({} as Record<ImportFieldKey, string>);
  const [existingSkus, setExistingSkus] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<ImportJobRow[]>([]);

  const [importing, setImporting] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    insertedCount: number;
    failedCount: number;
    errors: Array<{ rowNumber: number; sku: string; message: string }>;
  } | null>(null);

  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [barcodeMatch, setBarcodeMatch] = useState<Record<string, unknown> | null>(null);
  const [barcodeSearched, setBarcodeSearched] = useState(false);

  const loadMetadata = async () => {
    try {
      const [jobsRes, medsRes] = await Promise.all([
        apiFetch<{ jobs: ImportJobRow[] }>('/api/admin/medicines/import-jobs'),
        apiFetch<{ medicines: Array<{ sku: string }> }>('/api/admin/medicines'),
      ]);
      setJobs(jobsRes.jobs);
      setExistingSkus(new Set(medsRes.medicines.map((m) => String(m.sku).toUpperCase())));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadMetadata();
  }, []);

  const handleFileSelect = async (file: File | null) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        showToast('No sheet found inside uploaded file', 'error');
        return;
      }
      const ws = wb.Sheets[sheetName];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (parsed.length === 0) {
        showToast('Uploaded file contains zero rows', 'error');
        return;
      }
      const cols = Object.keys(parsed[0]);
      const autoMap = {} as Record<ImportFieldKey, string>;
      for (const field of IMPORT_TARGET_FIELDS) {
        const aliases = AUTO_MAP_ALIASES[field.key];
        const match = cols.find((c) => aliases.includes(c.trim().toLowerCase()));
        autoMap[field.key] = match || '';
      }

      setFileName(file.name);
      setHeaders(cols);
      setRawRows(parsed);
      setColumnMap(autoMap);
      setImportResult(null);
      setProgressPct(0);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to parse spreadsheet file', 'error');
    }
  };

  const mappedPreview = useMemo(() => {
    const seenFileSkus = new Set<string>();
    return rawRows.map((row, idx) => {
      const getVal = (key: ImportFieldKey) => {
        const col = columnMap[key];
        return col ? row[col] : undefined;
      };

      const name = String(getVal('name') ?? '').trim();
      const genericName = String(getVal('genericName') ?? '').trim();
      const composition = String(getVal('composition') ?? '').trim();
      const sku = String(getVal('sku') ?? '').trim();
      const mrpRupees = Number(getVal('mrpRupees') ?? 0);
      const salePriceRupees = Number(getVal('salePriceRupees') ?? 0);
      const rxRaw = String(getVal('requiresPrescription') ?? '').trim().toUpperCase();
      const requiresPrescription = rxRaw === 'YES' || rxRaw === 'TRUE' || rxRaw === '1';
      const schedRaw = String(getVal('scheduleType') ?? '').trim();
      const scheduleType: 'OTC' | 'Schedule H' | 'Schedule H1' =
        schedRaw === 'Schedule H1' ? 'Schedule H1' : schedRaw === 'Schedule H' ? 'Schedule H' : requiresPrescription ? 'Schedule H' : 'OTC';

      const issues: string[] = [];
      if (name.length < 2) issues.push('Missing Name');
      if (genericName.length < 2) issues.push('Missing Generic');
      if (composition.length < 2) issues.push('Missing Composition');
      if (sku.length < 2) issues.push('Missing SKU');
      if (!mrpRupees || mrpRupees < 1) issues.push('Invalid MRP');
      if (!salePriceRupees || salePriceRupees < 1) issues.push('Invalid Sale Price');

      const skuUpper = sku.toUpperCase();
      if (skuUpper && existingSkus.has(skuUpper)) issues.push('Duplicate SKU (in catalogue)');
      if (skuUpper && seenFileSkus.has(skuUpper)) issues.push('Duplicate SKU (in file)');
      if (skuUpper) seenFileSkus.add(skuUpper);

      const payload = {
        name,
        genericName,
        composition,
        manufacturer: String(getVal('manufacturer') ?? '').trim() || 'Apex Care Formulations (Demo)',
        brand: String(getVal('brand') ?? '').trim() || null,
        categorySlug: String(getVal('categorySlug') ?? '').trim() || 'tablets-and-capsules',
        dosageForm: String(getVal('dosageForm') ?? '').trim() || 'Tablet',
        strength: String(getVal('strength') ?? '').trim() || null,
        packSize: String(getVal('packSize') ?? '').trim() || 'Strip of 10 Tablets',
        sku,
        barcode: String(getVal('barcode') ?? '').trim() || null,
        hsnCode: String(getVal('hsnCode') ?? '').trim() || null,
        gstPercent: Math.max(0, Math.min(28, Number(getVal('gstPercent') || 12))),
        mrpPaise: Math.round(mrpRupees * 100),
        salePricePaise: Math.round(salePriceRupees * 100),
        requiresPrescription,
        scheduleType,
        batchNumber: String(getVal('batchNumber') ?? '').trim() || `IMP-${Date.now().toString().slice(-4)}-${idx + 1}`,
        mfgDate: String(getVal('mfgDate') ?? '').trim() || null,
        expiryDate: String(getVal('expiryDate') ?? '').trim() || '2028-06-30',
        initialStock: Math.max(0, Math.round(Number(getVal('initialStock') || 15))),
        purchasePricePaise: getVal('purchasePriceRupees')
          ? Math.round(Number(getVal('purchasePriceRupees')) * 100)
          : undefined,
        storageConditions: String(getVal('storageConditions') ?? '').trim() || 'Store below 25°C',
      };

      return { rowNumber: idx + 1, issues, payload };
    });
  }, [rawRows, columnMap, existingSkus]);

  const handleRunImport = async () => {
    if (mappedPreview.length === 0) return;
    setImporting(true);
    setProgressPct(25);
    try {
      const timer = window.setInterval(() => {
        setProgressPct((p) => (p < 85 ? p + 15 : p));
      }, 150);

      const res = await apiFetch<{
        totalRows: number;
        insertedCount: number;
        failedCount: number;
        errors: Array<{ rowNumber: number; sku: string; message: string }>;
      }>('/api/admin/medicines/import', {
        method: 'POST',
        body: JSON.stringify({
          fileName: fileName || 'bulk_upload.csv',
          rows: mappedPreview.map((r) => r.payload),
        }),
      });

      window.clearInterval(timer);
      setProgressPct(100);
      setImportResult(res);
      showToast(
        `Bulk import finished: ${res.insertedCount} staged as DRAFT${res.failedCount ? `, ${res.failedCount} skipped` : ''}`
      );
      await loadMetadata();
    } catch (err: unknown) {
      setProgressPct(0);
      showToast(err instanceof Error ? err.message : 'Bulk import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleBarcodeLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeQuery.trim()) return;
    setBarcodeSearched(true);
    try {
      const res = await apiFetch<{ medicine: Record<string, unknown> | null }>(
        `/api/admin/medicines/barcode/${encodeURIComponent(barcodeQuery.trim())}`
      );
      setBarcodeMatch(res.medicine);
    } catch {
      setBarcodeMatch(null);
    }
  };

  return (
    <AdminLayout title="Bulk Inventory Onboarding & Export">
      <div className="space-y-6">
        {/* Top Action & Barcode Strip */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#202630]">1. Download Template or Export Live Catalogue</h2>
                <p className="text-xs text-[#526071] mt-0.5">
                  All bulk-imported medicines enter as <span className="font-semibold text-[#202630]">DRAFT</span> pending Registered Pharmacist approval before appearing on the storefront.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/admin/medicines/import-template?format=csv"
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-[#E1E5EB] bg-white px-3 text-xs font-medium text-[#202630] hover:bg-[#F5F7FA]"
                >
                  <Download className="h-3.5 w-3.5" /> CSV Template
                </a>
                <a
                  href="/api/admin/medicines/import-template?format=xlsx"
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-[#E1E5EB] bg-white px-3 text-xs font-medium text-[#202630] hover:bg-[#F5F7FA]"
                >
                  <Download className="h-3.5 w-3.5" /> Excel (.xlsx) Template
                </a>
                <a
                  href="/api/admin/medicines/export?format=xlsx"
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-[#16835D] bg-[#F2FBF7] px-3 text-xs font-semibold text-[#16835D] hover:bg-[#E4F7EE]"
                >
                  <Download className="h-3.5 w-3.5" /> Export Inventory (.xlsx)
                </a>
              </div>
            </div>

            <label
              className="flex flex-col items-center justify-center rounded-md border border-dashed border-[#CBD2D9] bg-[#FAFBFD] p-6 text-center cursor-pointer hover:border-[#D71920] transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFileSelect(e.dataTransfer.files?.[0] || null);
              }}
            >
              <Upload className="h-6 w-6 text-[#D71920] mb-2" />
              <div className="text-sm font-semibold text-[#202630]">
                {fileName ? `Loaded: ${fileName} (${rawRows.length} rows)` : 'Drop CSV, TSV, XLS, or XLSX spreadsheet here or click to browse'}
              </div>
              <div className="text-xs text-[#526071] mt-1">
                Supports duplicate SKU/barcode validation, column mapping, and batch stock creation
              </div>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.tsv"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
              />
            </label>
          </Card>

          <Card className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Barcode className="h-4 w-4 text-[#D71920]" />
              <h2 className="text-base font-bold text-[#202630]">Barcode / SKU Scanner Lookup</h2>
            </div>
            <form onSubmit={handleBarcodeLookup} className="flex gap-2">
              <Input
                value={barcodeQuery}
                onChange={(e) => setBarcodeQuery(e.target.value)}
                placeholder="Scan barcode or enter SKU..."
              />
              <Button type="submit" size="sm">Lookup</Button>
            </form>
            {barcodeSearched && (
              barcodeMatch ? (
                <div className="rounded border border-[#E1E5EB] bg-[#FAFBFD] p-3 text-xs space-y-1">
                  <div className="font-bold text-[#202630]">{String(barcodeMatch.name)}</div>
                  <div className="text-[#526071]">
                    SKU: <span className="font-mono">{String(barcodeMatch.sku)}</span> · {String(barcodeMatch.category_name)}
                  </div>
                  <div className="flex justify-between pt-1">
                    <span>MRP {formatINRPaise(Number(barcodeMatch.mrp_paise))}</span>
                    <span className="font-semibold text-[#16835D] tabular-nums">
                      Stock: {Number(barcodeMatch.available_stock)} units
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded border border-[#E1E5EB] p-3 text-xs text-[#526071]">
                  No catalogue item matches barcode/SKU &ldquo;{barcodeQuery}&rdquo;.
                </div>
              )
            )}
          </Card>
        </div>

        {/* Column Mapping & Validation Preview */}
        {rawRows.length > 0 && (
          <Card className="p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#202630]">2. Column Mapping &amp; Pre-Import Validation</h2>
                <p className="text-xs text-[#526071]">
                  Ready rows: {mappedPreview.filter((r) => r.issues.length === 0).length} · Flagged rows: {mappedPreview.filter((r) => r.issues.length > 0).length}
                </p>
              </div>
              <Button onClick={handleRunImport} disabled={importing}>
                {importing ? 'Importing Rows...' : `Stage ${rawRows.length} Rows as Drafts`}
              </Button>
            </div>

            {progressPct > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-[#526071]">
                  <span>Import Progress</span>
                  <span className="tabular-nums font-semibold">{progressPct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#E1E5EB]">
                  <div className="h-full bg-[#16835D] transition-all duration-200" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {IMPORT_TARGET_FIELDS.map((field) => (
                <div key={field.key}>
                  <Label className="text-[11px]">{field.label}</Label>
                  <Select
                    className="h-8 text-xs"
                    value={columnMap[field.key] || ''}
                    onChange={(e) => setColumnMap({ ...columnMap, [field.key]: e.target.value })}
                  >
                    <option value="">-- Skip / Default --</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>

            <Table>
              <thead>
                <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                  <th className="py-2 font-medium">#</th>
                  <th className="py-2 font-medium">SKU</th>
                  <th className="py-2 font-medium">Medicine Name</th>
                  <th className="py-2 font-medium">Batch / Expiry</th>
                  <th className="py-2 text-right font-medium">MRP / Sale</th>
                  <th className="py-2 text-right font-medium">Stock</th>
                  <th className="py-2 pl-3 font-medium">Validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EB]">
                {mappedPreview.slice(0, 25).map((r) => (
                  <tr key={r.rowNumber} className="text-xs">
                    <td className="py-2 tabular-nums text-[#526071]">{r.rowNumber}</td>
                    <td className="py-2 font-mono">{r.payload.sku || '—'}</td>
                    <td className="py-2 font-semibold">{r.payload.name || '—'}</td>
                    <td className="py-2 text-[#526071] tabular-nums">{r.payload.batchNumber} · {r.payload.expiryDate}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatINRPaise(r.payload.mrpPaise)} / {formatINRPaise(r.payload.salePricePaise)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.payload.initialStock}</td>
                    <td className="py-2 pl-3">
                      {r.issues.length === 0 ? (
                        <span className="inline-flex items-center gap-1 text-[#16835D] font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Valid (Draft)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[#D71920] font-medium">
                          <AlertTriangle className="h-3.5 w-3.5" /> {r.issues.join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}

        {/* Import Result Report */}
        {importResult && (
          <Card className="p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#202630]">Import Summary Report</h3>
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div className="rounded border border-[#E1E5EB] p-3">
                <div className="text-[#526071]">Total Processed</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{importResult.totalRows}</div>
              </div>
              <div className="rounded border border-[#E1E5EB] p-3">
                <div className="text-[#526071]">Staged as Drafts</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-[#16835D]">{importResult.insertedCount}</div>
              </div>
              <div className="rounded border border-[#E1E5EB] p-3">
                <div className="text-[#526071]">Rejected Rows</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-[#D71920]">{importResult.failedCount}</div>
              </div>
            </div>
            {importResult.errors.length > 0 && (
              <div className="max-h-44 overflow-y-auto rounded border border-[#E1E5EB] p-3 text-xs space-y-1">
                {importResult.errors.map((e, i) => (
                  <div key={i} className="text-[#B4141A]">
                    Row {e.rowNumber} ({e.sku}): {e.message}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Historical Import Jobs */}
        <Card className="p-5">
          <h2 className="mb-3 text-base font-bold text-[#202630]">Recent Bulk Import Jobs</h2>
          {jobs.length === 0 ? (
            <p className="text-xs text-[#526071]">No bulk import batches recorded yet.</p>
          ) : (
            <Table>
              <thead>
                <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                  <th className="py-2 font-medium">Timestamp</th>
                  <th className="py-2 font-medium">File Name</th>
                  <th className="py-2 font-medium">Uploaded By</th>
                  <th className="py-2 text-right font-medium">Total</th>
                  <th className="py-2 text-right font-medium">Inserted</th>
                  <th className="py-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EB]">
                {jobs.map((j) => (
                  <tr key={j.id} className="text-xs">
                    <td className="py-2 text-[#526071] tabular-nums">{formatIndianDateTime(j.created_at)}</td>
                    <td className="py-2 font-semibold">{j.file_name}</td>
                    <td className="py-2">{j.uploaded_by_name || 'Staff'}</td>
                    <td className="py-2 text-right tabular-nums">{j.total_rows}</td>
                    <td className="py-2 text-right tabular-nums text-[#16835D] font-semibold">{j.inserted_rows}</td>
                    <td className="py-2 text-right tabular-nums text-[#D71920]">{j.failed_rows}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// 2. SUPPLIERS, PURCHASE ORDERS, GRN RECEIVING & SUPPLIER PAYMENT LEDGER
// ===========================================================================
interface SupplierRow {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string;
  email: string | null;
  gstin: string | null;
  drug_license: string | null;
  address: string | null;
  outstanding_paise: number;
  po_count: number;
}

interface PurchaseOrderItemRow {
  id: string;
  medicine_id: string;
  medicine_name: string;
  sku: string;
  pack_size: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost_paise: number;
  mrp_paise: number | null;
}

interface PurchaseOrderRow {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  supplier_phone: string;
  status: string;
  expected_date: string | null;
  subtotal_paise: number;
  paid_paise: number;
  payment_status: string;
  invoice_url: string | null;
  notes: string | null;
  created_at: string;
  items: PurchaseOrderItemRow[];
}

interface SupplierPaymentRow {
  id: string;
  purchase_order_id: string;
  supplier_name: string;
  amount_paise: number;
  method: string;
  reference: string | null;
  paid_at: string;
}

export function AdminSuppliersPage() {
  const { showToast } = useApp();
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [pos, setPos] = useState<PurchaseOrderRow[]>([]);
  const [payments, setPayments] = useState<SupplierPaymentRow[]>([]);
  const [medicines, setMedicines] = useState<Array<{ id: string; name: string; sku: string; mrp_paise: number }>>([]);
  const [tab, setTab] = useState<'pos' | 'suppliers' | 'payments'>('pos');

  const [supForm, setSupForm] = useState({
    name: '',
    contactName: '',
    phone: '',
    email: '',
    gstin: '',
    drugLicense: '',
    address: '',
  });

  const [poForm, setPoForm] = useState({
    supplierId: '',
    expectedDate: '',
    notes: '',
    medicineId: '',
    quantityOrdered: '20',
    unitCostRupees: '85',
    mrpRupees: '125',
  });

  const [grnPo, setGrnPo] = useState<PurchaseOrderRow | null>(null);
  const [grnRows, setGrnRows] = useState<
    Record<
      string,
      {
        quantityReceived: string;
        batchNumber: string;
        mfgDate: string;
        expiryDate: string;
        mrpRupees: string;
        storageConditions: string;
      }
    >
  >({});

  const [payPo, setPayPo] = useState<PurchaseOrderRow | null>(null);
  const [payForm, setPayForm] = useState({ amountRupees: '', method: 'NEFT', reference: '' });

  const load = async () => {
    try {
      const [sRes, poRes, medRes] = await Promise.all([
        apiFetch<{ suppliers: SupplierRow[] }>('/api/admin/suppliers'),
        apiFetch<{ purchaseOrders: PurchaseOrderRow[]; supplierPayments: SupplierPaymentRow[] }>('/api/admin/purchase-orders'),
        apiFetch<{ medicines: Array<{ id: string; name: string; sku: string; mrp_paise: number }> }>('/api/admin/medicines'),
      ]);
      setSuppliers(sRes.suppliers);
      setPos(poRes.purchaseOrders);
      setPayments(poRes.supplierPayments);
      setMedicines(medRes.medicines);
      setPoForm((prev) => ({
        ...prev,
        supplierId: prev.supplierId || sRes.suppliers[0]?.id || '',
        medicineId: prev.medicineId || medRes.medicines[0]?.id || '',
      }));
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/suppliers', {
        method: 'POST',
        body: JSON.stringify(supForm),
      });
      showToast('Distributor added');
      setSupForm({ name: '', contactName: '', phone: '', email: '', gstin: '', drugLicense: '', address: '' });
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to save supplier', 'error');
    }
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: poForm.supplierId,
          expectedDate: poForm.expectedDate || null,
          notes: poForm.notes || null,
          items: [
            {
              medicineId: poForm.medicineId,
              quantityOrdered: Number(poForm.quantityOrdered),
              unitCostPaise: Math.round(Number(poForm.unitCostRupees) * 100),
              mrpPaise: Math.round(Number(poForm.mrpRupees) * 100),
            },
          ],
        }),
      });
      showToast('Purchase Order issued');
      setPoForm({ ...poForm, notes: '', quantityOrdered: '20' });
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to create PO', 'error');
    }
  };

  const openGrn = (po: PurchaseOrderRow) => {
    const initial: typeof grnRows = {};
    for (const item of po.items) {
      const remaining = Math.max(0, item.quantity_ordered - item.quantity_received);
      initial[item.id] = {
        quantityReceived: String(remaining || item.quantity_ordered),
        batchNumber: `GRN-${Date.now().toString().slice(-4)}`,
        mfgDate: '2026-02-01',
        expiryDate: '2028-02-28',
        mrpRupees: String(((item.mrp_paise || item.unit_cost_paise * 1.3) / 100).toFixed(2)),
        storageConditions: 'Store below 25°C',
      };
    }
    setGrnRows(initial);
    setGrnPo(po);
  };

  const handleReceiveGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grnPo) return;
    try {
      const items = grnPo.items
        .map((it) => {
          const row = grnRows[it.id];
          const qty = Number(row?.quantityReceived || 0);
          if (!row || qty <= 0) return null;
          return {
            poItemId: it.id,
            quantityReceived: qty,
            batchNumber: row.batchNumber,
            mfgDate: row.mfgDate || null,
            expiryDate: row.expiryDate,
            mrpPaise: Math.round(Number(row.mrpRupees) * 100),
            storageConditions: row.storageConditions || null,
          };
        })
        .filter(Boolean);

      await apiFetch(`/api/admin/purchase-orders/${grnPo.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({ items }),
      });
      showToast(`GRN recorded & batches added to inventory for ${grnPo.po_number}`);
      setGrnPo(null);
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'GRN failed', 'error');
    }
  };

  const handleUploadInvoice = async (poId: string, file: File | null) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await apiFetch(`/api/admin/purchase-orders/${poId}/invoice`, { method: 'POST', body: fd });
      showToast('Supplier tax invoice uploaded');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payPo) return;
    try {
      await apiFetch(`/api/admin/purchase-orders/${payPo.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          amountPaise: Math.round(Number(payForm.amountRupees) * 100),
          method: payForm.method,
          reference: payForm.reference || undefined,
        }),
      });
      showToast('Supplier payment recorded');
      setPayPo(null);
      setPayForm({ amountRupees: '', method: 'NEFT', reference: '' });
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Payment failed', 'error');
    }
  };

  return (
    <AdminLayout title="Suppliers, Purchase Orders & GRN">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={tab === 'pos' ? 'default' : 'outline'} onClick={() => setTab('pos')}>
            <FileText className="h-3.5 w-3.5" /> Purchase Orders &amp; GRN ({pos.length})
          </Button>
          <Button size="sm" variant={tab === 'suppliers' ? 'default' : 'outline'} onClick={() => setTab('suppliers')}>
            <Truck className="h-3.5 w-3.5" /> Distributors ({suppliers.length})
          </Button>
          <Button size="sm" variant={tab === 'payments' ? 'default' : 'outline'} onClick={() => setTab('payments')}>
            <IndianRupee className="h-3.5 w-3.5" /> Supplier Payment Ledger ({payments.length})
          </Button>
        </div>

        {tab === 'pos' && (
          <>
            <Card className="p-5 space-y-4">
              <h2 className="text-base font-bold text-[#202630]">Raise New Purchase Order</h2>
              <form onSubmit={handleCreatePo} className="grid grid-cols-1 gap-3 sm:grid-cols-6 items-end">
                <div className="sm:col-span-2">
                  <Label>Supplier</Label>
                  <Select value={poForm.supplierId} onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })}>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Label>Medicine</Label>
                  <Select value={poForm.medicineId} onChange={(e) => setPoForm({ ...poForm, medicineId: e.target.value })}>
                    {medicines.map((m) => (
                      <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Qty</Label>
                  <Input type="number" min="1" required value={poForm.quantityOrdered} onChange={(e) => setPoForm({ ...poForm, quantityOrdered: e.target.value })} />
                </div>
                <div>
                  <Label>Unit Cost (₹)</Label>
                  <Input type="number" min="1" step="0.01" required value={poForm.unitCostRupees} onChange={(e) => setPoForm({ ...poForm, unitCostRupees: e.target.value })} />
                </div>
                <div>
                  <Label>Expected MRP (₹)</Label>
                  <Input type="number" min="1" step="0.01" required value={poForm.mrpRupees} onChange={(e) => setPoForm({ ...poForm, mrpRupees: e.target.value })} />
                </div>
                <div>
                  <Label>Expected Date</Label>
                  <Input type="date" value={poForm.expectedDate} onChange={(e) => setPoForm({ ...poForm, expectedDate: e.target.value })} />
                </div>
                <div className="sm:col-span-3">
                  <Label>PO Notes</Label>
                  <Input value={poForm.notes} onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })} placeholder="Weekly stock replenishment..." />
                </div>
                <div>
                  <Button type="submit" className="w-full"><Plus className="h-3.5 w-3.5" /> Create PO</Button>
                </div>
              </form>
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 text-base font-bold text-[#202630]">Purchase Orders</h2>
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">PO Number</th>
                    <th className="py-2 font-medium">Supplier</th>
                    <th className="py-2 font-medium">Items</th>
                    <th className="py-2 font-medium">GRN Status</th>
                    <th className="py-2 text-right font-medium">Total / Paid</th>
                    <th className="py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {pos.map((po) => (
                    <tr key={po.id} className="text-xs align-top">
                      <td className="py-2.5">
                        <div className="font-mono font-bold text-[#202630]">{po.po_number}</div>
                        <div className="text-[11px] text-[#526071] tabular-nums">{formatIndianDateTime(po.created_at)}</div>
                      </td>
                      <td className="py-2.5">
                        <div className="font-semibold">{po.supplier_name}</div>
                        <div className="text-[11px] text-[#526071]">{po.supplier_phone}</div>
                      </td>
                      <td className="py-2.5">
                        {po.items.map((it) => (
                          <div key={it.id} className="text-[11px]">
                            {it.medicine_name}: <span className="tabular-nums font-semibold">{it.quantity_received}/{it.quantity_ordered}</span>
                          </div>
                        ))}
                      </td>
                      <td className="py-2.5">
                        <div className="font-semibold">{po.status}</div>
                        <div className="text-[11px] text-[#526071]">Pay: {po.payment_status}</div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        <div className="font-bold">{formatINRPaise(po.subtotal_paise)}</div>
                        <div className="text-[11px] text-[#16835D]">Paid {formatINRPaise(po.paid_paise)}</div>
                      </td>
                      <td className="py-2.5 text-right space-x-1.5 whitespace-nowrap">
                        {po.status !== 'RECEIVED' && (
                          <Button size="sm" variant="secondary" onClick={() => openGrn(po)}>
                            Receive GRN
                          </Button>
                        )}
                        {po.paid_paise < po.subtotal_paise && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPayPo(po);
                              setPayForm({
                                amountRupees: ((po.subtotal_paise - po.paid_paise) / 100).toFixed(2),
                                method: 'NEFT',
                                reference: '',
                              });
                            }}
                          >
                            Record Pay
                          </Button>
                        )}
                        <label className="inline-flex h-8 items-center rounded border border-[#E1E5EB] px-2.5 text-xs font-medium cursor-pointer hover:bg-[#F5F7FA]">
                          {po.invoice_url ? 'Invoice OK' : 'Upload Inv'}
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            className="hidden"
                            onChange={(e) => handleUploadInvoice(po.id, e.target.files?.[0] || null)}
                          />
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </>
        )}

        {tab === 'suppliers' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h2 className="mb-3 text-base font-bold text-[#202630]">Registered Pharmaceutical Distributors</h2>
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">Distributor</th>
                    <th className="py-2 font-medium">Contact &amp; GSTIN</th>
                    <th className="py-2 text-right font-medium">POs</th>
                    <th className="py-2 text-right font-medium">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {suppliers.map((s) => (
                    <tr key={s.id} className="text-xs">
                      <td className="py-2.5">
                        <div className="font-semibold text-[#202630]">{s.name}</div>
                        <div className="text-[11px] text-[#526071]">{s.address || 'Mira Road / Thane'}</div>
                      </td>
                      <td className="py-2.5">
                        <div>{s.phone} {s.contact_name ? `· ${s.contact_name}` : ''}</div>
                        <div className="text-[11px] font-mono text-[#526071]">{s.gstin || 'No GSTIN'} · DL: {s.drug_license || '—'}</div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{s.po_count}</td>
                      <td className="py-2.5 text-right font-bold tabular-nums text-[#D71920]">
                        {formatINRPaise(s.outstanding_paise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>

            <Card className="p-5 space-y-3">
              <h2 className="text-base font-bold text-[#202630]">Add Distributor</h2>
              <form onSubmit={handleCreateSupplier} className="space-y-3">
                <div><Label>Agency / Distributor Name*</Label><Input required value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Contact Person</Label><Input value={supForm.contactName} onChange={(e) => setSupForm({ ...supForm, contactName: e.target.value })} /></div>
                  <div><Label>Phone*</Label><Input required value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>GSTIN</Label><Input value={supForm.gstin} onChange={(e) => setSupForm({ ...supForm, gstin: e.target.value })} /></div>
                  <div><Label>Drug License</Label><Input value={supForm.drugLicense} onChange={(e) => setSupForm({ ...supForm, drugLicense: e.target.value })} /></div>
                </div>
                <div><Label>Email</Label><Input type="email" value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} /></div>
                <div><Label>Address</Label><Input value={supForm.address} onChange={(e) => setSupForm({ ...supForm, address: e.target.value })} /></div>
                <Button type="submit" className="w-full">Save Supplier</Button>
              </form>
            </Card>
          </div>
        )}

        {tab === 'payments' && (
          <Card className="p-5">
            <h2 className="mb-3 text-base font-bold text-[#202630]">Supplier Payment History</h2>
            <Table>
              <thead>
                <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                  <th className="py-2 font-medium">Paid At</th>
                  <th className="py-2 font-medium">Supplier</th>
                  <th className="py-2 font-medium">Method / Ref</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EB]">
                {payments.map((pm) => (
                  <tr key={pm.id} className="text-xs">
                    <td className="py-2.5 tabular-nums text-[#526071]">{formatIndianDateTime(pm.paid_at)}</td>
                    <td className="py-2.5 font-semibold">{pm.supplier_name}</td>
                    <td className="py-2.5">{pm.method} · {pm.reference || '—'}</td>
                    <td className="py-2.5 text-right font-bold tabular-nums text-[#16835D]">{formatINRPaise(pm.amount_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}

        {/* GRN Modal */}
        {grnPo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <Card className="max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-[#E1E5EB] pb-3">
                <div>
                  <h3 className="text-base font-bold">Goods Receipt Note (GRN) · {grnPo.po_number}</h3>
                  <p className="text-xs text-[#526071]">Creates traceable medicine batches with expiry &amp; storage rules</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setGrnPo(null)}>Close</Button>
              </div>
              <form onSubmit={handleReceiveGrn} className="space-y-4">
                {grnPo.items.map((it) => {
                  const row = grnRows[it.id];
                  if (!row) return null;
                  return (
                    <div key={it.id} className="rounded border border-[#E1E5EB] p-3 space-y-2">
                      <div className="text-xs font-bold text-[#202630]">
                        {it.medicine_name} ({it.sku}) · Ordered: {it.quantity_ordered} · Already Received: {it.quantity_received}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <div>
                          <Label>Qty Received</Label>
                          <Input
                            type="number"
                            min="0"
                            value={row.quantityReceived}
                            onChange={(e) => setGrnRows({ ...grnRows, [it.id]: { ...row, quantityReceived: e.target.value } })}
                          />
                        </div>
                        <div>
                          <Label>Batch No.*</Label>
                          <Input
                            required
                            value={row.batchNumber}
                            onChange={(e) => setGrnRows({ ...grnRows, [it.id]: { ...row, batchNumber: e.target.value } })}
                          />
                        </div>
                        <div>
                          <Label>MRP (₹)*</Label>
                          <Input
                            type="number"
                            step="0.01"
                            required
                            value={row.mrpRupees}
                            onChange={(e) => setGrnRows({ ...grnRows, [it.id]: { ...row, mrpRupees: e.target.value } })}
                          />
                        </div>
                        <div>
                          <Label>Mfg Date</Label>
                          <Input
                            type="date"
                            value={row.mfgDate}
                            onChange={(e) => setGrnRows({ ...grnRows, [it.id]: { ...row, mfgDate: e.target.value } })}
                          />
                        </div>
                        <div>
                          <Label>Expiry Date*</Label>
                          <Input
                            type="date"
                            required
                            value={row.expiryDate}
                            onChange={(e) => setGrnRows({ ...grnRows, [it.id]: { ...row, expiryDate: e.target.value } })}
                          />
                        </div>
                        <div>
                          <Label>Storage Conditions</Label>
                          <Input
                            value={row.storageConditions}
                            onChange={(e) => setGrnRows({ ...grnRows, [it.id]: { ...row, storageConditions: e.target.value } })}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setGrnPo(null)}>Cancel</Button>
                  <Button type="submit">Post GRN &amp; Add Batches</Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {/* Payment Modal */}
        {payPo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <Card className="max-w-md w-full p-6 space-y-4">
              <h3 className="text-base font-bold">Record Supplier Payment · {payPo.po_number}</h3>
              <form onSubmit={handleRecordPayment} className="space-y-3">
                <div>
                  <Label>Amount (INR)*</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={payForm.amountRupees}
                    onChange={(e) => setPayForm({ ...payForm, amountRupees: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Payment Method</Label>
                  <Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                    <option value="NEFT">NEFT</option>
                    <option value="RTGS">RTGS</option>
                    <option value="UPI">UPI</option>
                    <option value="CHEQUE">CHEQUE</option>
                    <option value="CASH">CASH</option>
                  </Select>
                </div>
                <div>
                  <Label>UTR / Cheque Reference</Label>
                  <Input
                    value={payForm.reference}
                    onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                    placeholder="UTR-12345678"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setPayPo(null)}>Cancel</Button>
                  <Button type="submit">Save Payment</Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// 3. WEBSITE CONTENT (BANNERS, COUPONS, PINCODES, LEGAL POLICIES)
// ===========================================================================
interface PromoRow {
  id: string;
  title: string;
  subtitle: string;
  cta_label: string;
  cta_link: string;
  badge_text: string | null;
  image_url: string | null;
  is_active: number;
}

interface CouponRow {
  id: string;
  code: string;
  description: string;
  discount_type: 'PERCENT' | 'FLAT';
  discount_value: number;
  min_order_paise: number;
  max_discount_paise: number | null;
  is_active: number;
  expires_at: string | null;
}

interface PincodeRow {
  id: string;
  pincode: string;
  area_name: string;
  delivery_fee_paise: number;
  estimated_mins: number;
}

interface PolicyRow {
  id: string;
  slug: string;
  title: string;
  content: string;
  updated_at: string;
}

export function AdminContentPage() {
  const { showToast } = useApp();
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [pincodes, setPincodes] = useState<PincodeRow[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);

  const [promoForm, setPromoForm] = useState({
    title: '',
    subtitle: '',
    ctaLabel: 'Browse Catalog',
    ctaLink: '/pharmacy',
    badgeText: 'Store Update',
  });
  const [couponForm, setCouponForm] = useState({
    code: '',
    description: '',
    discountType: 'PERCENT' as 'PERCENT' | 'FLAT',
    discountValue: '10',
    minOrderRupees: '300',
    maxDiscountRupees: '100',
    expiresAt: '',
  });
  const [pinForm, setPinForm] = useState({
    pincode: '',
    areaName: '',
    deliveryFeeRupees: '25',
    estimatedMins: '40',
  });
  const [editingPolicy, setEditingPolicy] = useState<{ slug: string; title: string; content: string } | null>(null);

  const load = async () => {
    try {
      const [pr, cp, pn, pl] = await Promise.all([
        apiFetch<{ promotions: PromoRow[] }>('/api/admin/promotions'),
        apiFetch<{ coupons: CouponRow[] }>('/api/admin/coupons'),
        apiFetch<{ pincodes: PincodeRow[] }>('/api/admin/pincodes'),
        apiFetch<{ policies: PolicyRow[] }>('/api/admin/policies'),
      ]);
      setPromos(pr.promotions);
      setCoupons(cp.coupons);
      setPincodes(pn.pincodes);
      setPolicies(pl.policies);
      if (!editingPolicy && pl.policies[0]) {
        setEditingPolicy({
          slug: pl.policies[0].slug,
          title: pl.policies[0].title,
          content: pl.policies[0].content,
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/promotions', { method: 'POST', body: JSON.stringify(promoForm) });
      setPromoForm({ title: '', subtitle: '', ctaLabel: 'Browse Catalog', ctaLink: '/pharmacy', badgeText: 'Store Update' });
      showToast('Homepage banner added');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to add banner', 'error');
    }
  };

  const handleBannerImage = async (promoId: string, file: File | null) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await apiFetch(`/api/admin/promotions/${promoId}/image`, { method: 'POST', body: fd });
      showToast('Banner image uploaded');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Image upload failed', 'error');
    }
  };

  const handleCreateCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: couponForm.code,
          description: couponForm.description,
          discountType: couponForm.discountType,
          discountValue:
            couponForm.discountType === 'FLAT'
              ? Math.round(Number(couponForm.discountValue) * 100)
              : Number(couponForm.discountValue),
          minOrderPaise: Math.round(Number(couponForm.minOrderRupees || 0) * 100),
          maxDiscountPaise: couponForm.maxDiscountRupees ? Math.round(Number(couponForm.maxDiscountRupees) * 100) : null,
          expiresAt: couponForm.expiresAt || null,
        }),
      });
      setCouponForm({ code: '', description: '', discountType: 'PERCENT', discountValue: '10', minOrderRupees: '300', maxDiscountRupees: '100', expiresAt: '' });
      showToast('Coupon created');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to create coupon', 'error');
    }
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPolicy) return;
    try {
      await apiFetch(`/api/admin/policies/${editingPolicy.slug}`, {
        method: 'PUT',
        body: JSON.stringify({ title: editingPolicy.title, content: editingPolicy.content }),
      });
      showToast('Legal policy published to storefront');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Save policy failed', 'error');
    }
  };

  return (
    <AdminLayout title="Website Content, Coupons, PIN Codes & Legal Policies">
      <div className="space-y-6">
        {/* Promotional Banners */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#D71920]" />
            <h2 className="text-base font-bold text-[#202630]">Homepage Promotional Banners</h2>
          </div>
          <form onSubmit={handleCreatePromo} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label>Title*</Label><Input required value={promoForm.title} onChange={(e) => setPromoForm({ ...promoForm, title: e.target.value })} placeholder="Verified Pharmacy Delivery" /></div>
            <div><Label>Badge Text</Label><Input value={promoForm.badgeText} onChange={(e) => setPromoForm({ ...promoForm, badgeText: e.target.value })} /></div>
            <div><Label>CTA Label*</Label><Input required value={promoForm.ctaLabel} onChange={(e) => setPromoForm({ ...promoForm, ctaLabel: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Subtitle*</Label><Input required value={promoForm.subtitle} onChange={(e) => setPromoForm({ ...promoForm, subtitle: e.target.value })} /></div>
            <div><Label>CTA Link*</Label><Input required value={promoForm.ctaLink} onChange={(e) => setPromoForm({ ...promoForm, ctaLink: e.target.value })} /></div>
            <div className="sm:col-span-3"><Button type="submit" size="sm">Add Banner</Button></div>
          </form>

          <div className="divide-y divide-[#E1E5EB]">
            {promos.map((p) => (
              <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  {p.image_url && <img src={p.image_url} alt={p.title} className="h-10 w-16 rounded object-cover border border-[#E1E5EB]" />}
                  <div>
                    <div className="font-semibold text-[#202630]">{p.title}</div>
                    <div className="text-[#526071]">{p.subtitle} ({p.cta_link})</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex h-8 items-center rounded border border-[#E1E5EB] px-2.5 text-xs font-medium cursor-pointer hover:bg-[#F5F7FA]">
                    Upload Image
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleBannerImage(p.id, e.target.files?.[0] || null)} />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await apiFetch(`/api/admin/promotions/${p.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ isActive: !p.is_active }),
                      });
                      load();
                    }}
                  >
                    {p.is_active ? 'Visible' : 'Hidden'}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={async () => {
                      await apiFetch(`/api/admin/promotions/${p.id}`, { method: 'DELETE' });
                      load();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Coupons CRUD */}
        <Card className="p-5 space-y-4">
          <h2 className="text-base font-bold text-[#202630]">Promotional Coupon Codes</h2>
          <form onSubmit={handleCreateCoupon} className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
            <div><Label>Code*</Label><Input required value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })} placeholder="MIRA10" /></div>
            <div className="sm:col-span-2"><Label>Description*</Label><Input required value={couponForm.description} onChange={(e) => setCouponForm({ ...couponForm, description: e.target.value })} placeholder="10% off up to ₹100 on OTC" /></div>
            <div>
              <Label>Type</Label>
              <Select value={couponForm.discountType} onChange={(e) => setCouponForm({ ...couponForm, discountType: e.target.value as 'PERCENT' | 'FLAT' })}>
                <option value="PERCENT">Percent (%)</option>
                <option value="FLAT">Flat (₹)</option>
              </Select>
            </div>
            <div><Label>Value ({couponForm.discountType === 'PERCENT' ? '%' : '₹'})*</Label><Input type="number" min="1" required value={couponForm.discountValue} onChange={(e) => setCouponForm({ ...couponForm, discountValue: e.target.value })} /></div>
            <div><Label>Min Order (₹)</Label><Input type="number" min="0" value={couponForm.minOrderRupees} onChange={(e) => setCouponForm({ ...couponForm, minOrderRupees: e.target.value })} /></div>
            <div><Label>Max Cap (₹)</Label><Input type="number" min="0" value={couponForm.maxDiscountRupees} onChange={(e) => setCouponForm({ ...couponForm, maxDiscountRupees: e.target.value })} /></div>
            <div><Label>Expires At</Label><Input type="date" value={couponForm.expiresAt} onChange={(e) => setCouponForm({ ...couponForm, expiresAt: e.target.value })} /></div>
            <div><Button type="submit" size="sm" className="w-full">Create Coupon</Button></div>
          </form>

          <Table>
            <thead>
              <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                <th className="py-2 font-medium">Code</th>
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 font-medium">Discount</th>
                <th className="py-2 text-right font-medium">Min Order</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB]">
              {coupons.map((c) => (
                <tr key={c.id} className="text-xs">
                  <td className="py-2 font-mono font-bold text-[#202630]">{c.code}</td>
                  <td className="py-2 text-[#526071]">{c.description}</td>
                  <td className="py-2 font-semibold tabular-nums">
                    {c.discount_type === 'PERCENT' ? `${c.discount_value}%` : formatINRPaise(c.discount_value)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatINRPaise(c.min_order_paise)}</td>
                  <td className="py-2 text-right space-x-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await apiFetch(`/api/admin/coupons/${c.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ isActive: !c.is_active }),
                        });
                        load();
                      }}
                    >
                      {c.is_active ? 'Active' : 'Paused'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        await apiFetch(`/api/admin/coupons/${c.id}`, { method: 'DELETE' });
                        load();
                      }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        {/* Serviceable PIN Codes & Legal Policies */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="p-5 space-y-4">
            <h2 className="text-base font-bold text-[#202630]">Serviceable PIN Codes</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await apiFetch('/api/admin/pincodes', {
                    method: 'POST',
                    body: JSON.stringify({
                      pincode: pinForm.pincode,
                      areaName: pinForm.areaName,
                      deliveryFeePaise: Math.round(Number(pinForm.deliveryFeeRupees) * 100),
                      estimatedMins: Number(pinForm.estimatedMins),
                    }),
                  });
                  setPinForm({ pincode: '', areaName: '', deliveryFeeRupees: '25', estimatedMins: '40' });
                  showToast('PIN code saved');
                  load();
                } catch (err: unknown) {
                  showToast(err instanceof Error ? err.message : 'Invalid PIN code', 'error');
                }
              }}
              className="grid grid-cols-2 gap-2 sm:grid-cols-5 items-end"
            >
              <div><Label>PIN</Label><Input required maxLength={6} value={pinForm.pincode} onChange={(e) => setPinForm({ ...pinForm, pincode: e.target.value })} placeholder="401107" /></div>
              <div className="sm:col-span-2"><Label>Area</Label><Input required value={pinForm.areaName} onChange={(e) => setPinForm({ ...pinForm, areaName: e.target.value })} /></div>
              <div><Label>Fee (₹)</Label><Input type="number" required value={pinForm.deliveryFeeRupees} onChange={(e) => setPinForm({ ...pinForm, deliveryFeeRupees: e.target.value })} /></div>
              <Button type="submit" size="sm">Add</Button>
            </form>
            <Table>
              <thead>
                <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                  <th className="py-2 font-medium">PIN</th>
                  <th className="py-2 font-medium">Area</th>
                  <th className="py-2 text-right font-medium">Fee</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EB]">
                {pincodes.map((pin) => (
                  <tr key={pin.id} className="text-xs">
                    <td className="py-2 font-mono font-bold">{pin.pincode}</td>
                    <td className="py-2">{pin.area_name} ({pin.estimated_mins}m)</td>
                    <td className="py-2 text-right tabular-nums">{formatINRPaise(pin.delivery_fee_paise)}</td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await apiFetch(`/api/admin/pincodes/${pin.id}`, { method: 'DELETE' });
                          load();
                        }}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card className="p-5 space-y-4">
            <h2 className="text-base font-bold text-[#202630]">Pharmacy Legal &amp; Store Policies</h2>
            <div className="flex flex-wrap gap-1.5">
              {policies.map((p) => (
                <Button
                  key={p.slug}
                  size="sm"
                  variant={editingPolicy?.slug === p.slug ? 'default' : 'outline'}
                  onClick={() => setEditingPolicy({ slug: p.slug, title: p.title, content: p.content })}
                >
                  {p.title}
                </Button>
              ))}
            </div>
            {editingPolicy && (
              <form onSubmit={handleSavePolicy} className="space-y-3">
                <div>
                  <Label>Policy Title</Label>
                  <Input
                    required
                    value={editingPolicy.title}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, title: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Policy Content</Label>
                  <Textarea
                    rows={6}
                    required
                    value={editingPolicy.content}
                    onChange={(e) => setEditingPolicy({ ...editingPolicy, content: e.target.value })}
                  />
                </div>
                <Button type="submit" size="sm">Update Published Policy</Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// 4. SECURITY, STAFF RBAC DIRECTORY & AUDIT LOGS
// ===========================================================================
interface AuditLogRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata_json: string | null;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
}

interface StaffMemberRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  is_active: number;
  employee_code: string | null;
  designation: string | null;
  pharmacist_reg_number: string | null;
  roles: string;
}

export function AdminAuditLogsPage() {
  const { showToast } = useApp();
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [staff, setStaff] = useState<StaffMemberRow[]>([]);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  const [staffForm, setStaffForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: Role.PHARMACIST,
    designation: 'Registered Pharmacist',
    pharmacistRegNumber: '',
  });

  const load = async (act = actionFilter, ent = entityFilter) => {
    try {
      const qs = new URLSearchParams();
      if (act.trim()) qs.set('action', act.trim());
      if (ent.trim()) qs.set('entityType', ent.trim());
      const res = await apiFetch<{ logs: AuditLogRow[]; staff: StaffMemberRow[] }>(`/api/admin/audit-logs?${qs.toString()}`);
      setLogs(res.logs);
      setStaff(res.staff);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleProvisionStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/staff', {
        method: 'POST',
        body: JSON.stringify(staffForm),
      });
      showToast('Staff account provisioned');
      setStaffForm({
        fullName: '',
        email: '',
        phone: '',
        password: '',
        role: Role.PHARMACIST,
        designation: 'Registered Pharmacist',
        pharmacistRegNumber: '',
      });
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Provisioning failed', 'error');
    }
  };

  return (
    <AdminLayout title="Security, Staff RBAC & Audit Logs">
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#16835D]" />
              <h2 className="text-base font-bold text-[#202630]">Pharmacy Staff &amp; Role Access Matrix</h2>
            </div>
            <p className="text-xs text-[#526071]">
              Only <span className="font-semibold text-[#202630]">PHARMACIST</span> or <span className="font-semibold text-[#202630]">SUPER_ADMIN</span> accounts can clinically approve prescriptions or publish medicines live. Inventory Managers do not see customer Rx scans.
            </p>
            <Table>
              <thead>
                <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                  <th className="py-2 font-medium">Staff Name</th>
                  <th className="py-2 font-medium">Email &amp; Phone</th>
                  <th className="py-2 font-medium">Designation / Reg No.</th>
                  <th className="py-2 font-medium">Assigned Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EB]">
                {staff.map((st) => (
                  <tr key={st.id} className="text-xs">
                    <td className="py-2.5 font-semibold text-[#202630]">
                      {st.full_name}
                      {st.employee_code && <span className="ml-1.5 font-mono text-[10px] text-[#526071]">{st.employee_code}</span>}
                    </td>
                    <td className="py-2.5 text-[#526071]">{st.email} · {st.phone}</td>
                    <td className="py-2.5">
                      <div>{st.designation || 'Staff'}</div>
                      {st.pharmacist_reg_number && (
                        <div className="text-[11px] font-mono text-[#16835D]">Reg: {st.pharmacist_reg_number}</div>
                      )}
                    </td>
                    <td className="py-2.5 font-mono font-semibold text-[#202630]">{st.roles}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="text-base font-bold text-[#202630]">Provision Staff Account</h2>
            <form onSubmit={handleProvisionStaff} className="space-y-2.5">
              <div><Label>Full Name*</Label><Input required value={staffForm.fullName} onChange={(e) => setStaffForm({ ...staffForm, fullName: e.target.value })} /></div>
              <div><Label>Email*</Label><Input type="email" required value={staffForm.email} onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })} /></div>
              <div><Label>Phone*</Label><Input required value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Role</Label>
                  <Select value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value as typeof staffForm.role })}>
                    <option value={Role.PHARMACIST}>PHARMACIST</option>
                    <option value={Role.INVENTORY_MANAGER}>INVENTORY_MANAGER</option>
                    <option value={Role.STORE_ADMIN}>STORE_ADMIN</option>
                  </Select>
                </div>
                <div><Label>Designation*</Label><Input required value={staffForm.designation} onChange={(e) => setStaffForm({ ...staffForm, designation: e.target.value })} /></div>
              </div>
              {staffForm.role === Role.PHARMACIST && (
                <div>
                  <Label>Pharmacist Reg. Number (MSPC)</Label>
                  <Input
                    value={staffForm.pharmacistRegNumber}
                    onChange={(e) => setStaffForm({ ...staffForm, pharmacistRegNumber: e.target.value })}
                    placeholder="MH-PHARM-2026-..."
                  />
                </div>
              )}
              <div><Label>Initial Password (min 8)*</Label><Input type="password" required minLength={8} value={staffForm.password} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} /></div>
              <Button type="submit" className="w-full">Create Staff User</Button>
            </form>
          </Card>
        </div>

        {/* Filterable Audit Logs */}
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[#202630]">Sanitized System Audit Trail ({logs.length})</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                load();
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <Input
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                placeholder="Filter action (e.g. PRESCRIPTION)..."
                className="w-52 h-8 text-xs"
              />
              <Select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="w-40 h-8 text-xs">
                <option value="">All Entities</option>
                <option value="Order">Order</option>
                <option value="Prescription">Prescription</option>
                <option value="Medicine">Medicine</option>
                <option value="MedicineBatch">MedicineBatch</option>
                <option value="PurchaseOrder">PurchaseOrder</option>
                <option value="Payment">Payment</option>
                <option value="DeliveryPartner">DeliveryPartner</option>
                <option value="Store">Store</option>
              </Select>
              <Button type="submit" size="sm"><Search className="h-3.5 w-3.5" /> Filter</Button>
            </form>
          </div>

          <Table>
            <thead>
              <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                <th className="py-2 font-medium">Timestamp</th>
                <th className="py-2 font-medium">Actor</th>
                <th className="py-2 font-medium">Action</th>
                <th className="py-2 font-medium">Entity</th>
                <th className="py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB]">
              {logs.map((l) => (
                <tr key={l.id} className="text-xs">
                  <td className="py-2 tabular-nums text-[#526071] whitespace-nowrap">{formatIndianDateTime(l.created_at)}</td>
                  <td className="py-2">{l.actor_name || 'System'}</td>
                  <td className="py-2 font-mono font-semibold text-[#202630]">{l.action}</td>
                  <td className="py-2 text-[#526071]">{l.entity_type}</td>
                  <td className="py-2 font-mono text-[11px] text-[#526071] max-w-md truncate">{l.metadata_json || '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </AdminLayout>
  );
}
