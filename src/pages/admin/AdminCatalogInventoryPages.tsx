import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  ImagePlus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout.tsx';
import { Button, Card, Input, Label, Select, Table, Textarea } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { formatIndianDateTime, formatINRPaise, PublicationStatus, Role } from '../../shared/types.ts';

// ===========================================================================
// 1. INVENTORY MANAGEMENT (BATCHES, FEFO, EXPIRY ALERTS, QUARANTINE)
// ===========================================================================
interface BatchRow {
  id: string;
  medicine_id: string;
  medicine_name: string;
  sku: string;
  pack_size: string;
  batch_number: string;
  mfg_date: string | null;
  expiry_date: string;
  days_to_expiry: number;
  quantity_received: number;
  quantity_available: number;
  quantity_reserved: number;
  quantity_damaged: number;
  quantity_expired: number;
  purchase_price_paise: number;
  mrp_paise: number;
  storage_conditions: string | null;
  is_quarantined: number;
  quarantine_reason: string | null;
  supplier_name: string | null;
}

interface InvTxnRow {
  id: string;
  medicine_name: string;
  batch_number: string;
  txn_type: string;
  quantity_delta: number;
  notes: string | null;
  performed_by_name: string | null;
  created_at: string;
}

export function AdminInventoryPage() {
  const { showToast } = useApp();
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [medicines, setMedicines] = useState<Array<{ id: string; name: string; sku: string; mrp_paise: number }>>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [txns, setTxns] = useState<InvTxnRow[]>([]);
  const [alerts, setAlerts] = useState({
    outOfStock: 0,
    lowStock: 0,
    expired: 0,
    expiring30: 0,
    expiring60: 0,
    expiring90: 0,
    quarantined: 0,
  });
  const [valuation, setValuation] = useState({ costPaise: 0, mrpPaise: 0 });
  const [alertFilter, setAlertFilter] = useState<string>('ALL');

  const [selectedBatch, setSelectedBatch] = useState('');
  const [delta, setDelta] = useState('10');
  const [txnType, setTxnType] = useState('PURCHASE_RECEIPT');
  const [notes, setNotes] = useState('');

  const [showAddBatch, setShowAddBatch] = useState(false);
  const [newBatch, setNewBatch] = useState({
    medicineId: '',
    supplierId: '',
    batchNumber: '',
    mfgDate: '2026-01-01',
    expiryDate: '2028-06-30',
    purchasePriceRupees: '45',
    mrpRupees: '65',
    quantityReceived: '30',
    storageConditions: 'Store below 25°C in dry place',
  });

  const [quarantineTarget, setQuarantineTarget] = useState<BatchRow | null>(null);
  const [quarantineReason, setQuarantineReason] = useState('');

  const load = () => {
    apiFetch<{
      batches: BatchRow[];
      medicines: typeof medicines;
      suppliers: typeof suppliers;
      transactions: InvTxnRow[];
      alerts: typeof alerts;
      valuation: typeof valuation;
    }>('/api/admin/inventory')
      .then((d) => {
        setBatches(d.batches);
        setMedicines(d.medicines);
        setSuppliers(d.suppliers);
        setTxns(d.transactions);
        setAlerts(d.alerts);
        setValuation(d.valuation);
        if (!selectedBatch && d.batches.length > 0) setSelectedBatch(d.batches[0].id);
        if (!newBatch.medicineId && d.medicines.length > 0) {
          setNewBatch((prev) => ({
            ...prev,
            medicineId: d.medicines[0].id,
            mrpRupees: String(Math.round(d.medicines[0].mrp_paise / 100)),
          }));
        }
      })
      .catch(console.error);
  };

  useEffect(() => {
    load();
  }, []);

  const filteredBatches = useMemo(() => {
    return batches.filter((b) => {
      if (alertFilter === 'LOW_STOCK') return b.quantity_available > 0 && b.quantity_available <= 20;
      if (alertFilter === 'OUT_OF_STOCK') return b.quantity_available === 0;
      if (alertFilter === 'EXP_30') return b.days_to_expiry > 0 && b.days_to_expiry <= 30 && b.quantity_available > 0;
      if (alertFilter === 'EXP_60') return b.days_to_expiry > 30 && b.days_to_expiry <= 60 && b.quantity_available > 0;
      if (alertFilter === 'EXP_90') return b.days_to_expiry > 60 && b.days_to_expiry <= 90 && b.quantity_available > 0;
      if (alertFilter === 'EXPIRED_OR_QUARANTINED') return b.days_to_expiry <= 0 || Boolean(b.is_quarantined);
      return true;
    });
  }, [batches, alertFilter]);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (notes.trim().length < 3) {
      showToast('A mandatory adjustment reason (min 3 characters) is required', 'error');
      return;
    }
    try {
      await apiFetch('/api/admin/inventory/adjust', {
        method: 'POST',
        body: JSON.stringify({
          batchId: selectedBatch,
          quantityDelta: Number(delta),
          txnType,
          notes: notes.trim(),
        }),
      });
      showToast('Batch stock adjusted & audited');
      setNotes('');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Adjustment failed', 'error');
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/inventory/batches', {
        method: 'POST',
        body: JSON.stringify({
          medicineId: newBatch.medicineId,
          supplierId: newBatch.supplierId || null,
          batchNumber: newBatch.batchNumber,
          mfgDate: newBatch.mfgDate || null,
          expiryDate: newBatch.expiryDate,
          purchasePricePaise: Math.round(Number(newBatch.purchasePriceRupees) * 100),
          mrpPaise: Math.round(Number(newBatch.mrpRupees) * 100),
          quantityReceived: Number(newBatch.quantityReceived),
          storageConditions: newBatch.storageConditions,
        }),
      });
      showToast('New batch received into FEFO stock');
      setShowAddBatch(false);
      setNewBatch((prev) => ({ ...prev, batchNumber: '' }));
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to create batch', 'error');
    }
  };

  const submitQuarantine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quarantineTarget || quarantineReason.trim().length < 3) {
      showToast('Mandatory quarantine reason required', 'error');
      return;
    }
    try {
      await apiFetch(`/api/admin/inventory/batches/${quarantineTarget.id}/quarantine`, {
        method: 'PATCH',
        body: JSON.stringify({
          isQuarantined: !Boolean(quarantineTarget.is_quarantined),
          reason: quarantineReason.trim(),
        }),
      });
      showToast(quarantineTarget.is_quarantined ? 'Batch released from quarantine' : 'Batch quarantined from sale');
      setQuarantineTarget(null);
      setQuarantineReason('');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to update quarantine', 'error');
    }
  };

  return (
    <AdminLayout title="Batch Inventory & FEFO Control">
      <div className="space-y-6">
        {/* Alert Filter Strip + Valuation */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Card className="p-3.5">
            <div className="text-[11px] text-[#526071]">Stock Cost Valuation</div>
            <div className="mt-1 text-base font-bold tabular-nums">{formatINRPaise(valuation.costPaise)}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11px] text-[#526071]">Stock MRP Valuation</div>
            <div className="mt-1 text-base font-bold text-[#16835D] tabular-nums">{formatINRPaise(valuation.mrpPaise)}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11px] text-[#526071]">Low / Out of Stock</div>
            <div className="mt-1 text-base font-bold text-[#D71920] tabular-nums">
              {alerts.lowStock} / {alerts.outOfStock}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11px] text-[#526071]">Expiring ≤ 30d</div>
            <div className="mt-1 text-base font-bold text-[#D71920] tabular-nums">{alerts.expiring30}</div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11px] text-[#526071]">Expiring 31–90d</div>
            <div className="mt-1 text-base font-bold text-[#D97706] tabular-nums">
              {alerts.expiring60 + alerts.expiring90}
            </div>
          </Card>
          <Card className="p-3.5">
            <div className="text-[11px] text-[#526071]">Expired / Quarantined</div>
            <div className="mt-1 text-base font-bold tabular-nums">
              {alerts.expired} / {alerts.quarantined}
            </div>
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {[
              { k: 'ALL', l: `All Batches (${batches.length})` },
              { k: 'LOW_STOCK', l: `Low Stock (${alerts.lowStock})` },
              { k: 'OUT_OF_STOCK', l: `Out of Stock (${alerts.outOfStock})` },
              { k: 'EXP_30', l: `≤ 30d Expiry (${alerts.expiring30})` },
              { k: 'EXP_60', l: `31–60d (${alerts.expiring60})` },
              { k: 'EXP_90', l: `61–90d (${alerts.expiring90})` },
              { k: 'EXPIRED_OR_QUARANTINED', l: `Expired / Quarantined` },
            ].map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => setAlertFilter(t.k)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                  alertFilter === t.k ? 'bg-[#D71920] text-white' : 'bg-white border border-[#E1E5EB] text-[#526071]'
                }`}
              >
                {t.l}
              </button>
            ))}
          </div>
          <Button onClick={() => setShowAddBatch(!showAddBatch)}>
            {showAddBatch ? 'Close New Batch Form' : '+ Receive New Batch'}
          </Button>
        </div>

        {showAddBatch && (
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-bold">Receive New Medicine Batch</h2>
            <form onSubmit={handleCreateBatch} className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end">
              <div className="sm:col-span-2">
                <Label>Medicine</Label>
                <Select value={newBatch.medicineId} onChange={(e) => setNewBatch({ ...newBatch, medicineId: e.target.value })}>
                  {medicines.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Supplier</Label>
                <Select value={newBatch.supplierId} onChange={(e) => setNewBatch({ ...newBatch, supplierId: e.target.value })}>
                  <option value="">Direct / Unassigned</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Batch Number</Label>
                <Input required value={newBatch.batchNumber} onChange={(e) => setNewBatch({ ...newBatch, batchNumber: e.target.value })} placeholder="B26-901" />
              </div>
              <div>
                <Label>Mfg Date</Label>
                <Input type="date" value={newBatch.mfgDate} onChange={(e) => setNewBatch({ ...newBatch, mfgDate: e.target.value })} />
              </div>
              <div>
                <Label>Expiry Date</Label>
                <Input type="date" required value={newBatch.expiryDate} onChange={(e) => setNewBatch({ ...newBatch, expiryDate: e.target.value })} />
              </div>
              <div>
                <Label>Purchase Cost (INR)</Label>
                <Input type="number" required value={newBatch.purchasePriceRupees} onChange={(e) => setNewBatch({ ...newBatch, purchasePriceRupees: e.target.value })} />
              </div>
              <div>
                <Label>MRP (INR)</Label>
                <Input type="number" required value={newBatch.mrpRupees} onChange={(e) => setNewBatch({ ...newBatch, mrpRupees: e.target.value })} />
              </div>
              <div>
                <Label>Qty Received</Label>
                <Input type="number" min="1" required value={newBatch.quantityReceived} onChange={(e) => setNewBatch({ ...newBatch, quantityReceived: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Storage Conditions</Label>
                <Input value={newBatch.storageConditions} onChange={(e) => setNewBatch({ ...newBatch, storageConditions: e.target.value })} />
              </div>
              <Button type="submit" variant="secondary">Save Batch</Button>
            </form>
          </Card>
        )}

        {/* Mandatory Reason Adjustment Form */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-bold">Record Audited Stock Adjustment (Mandatory Reason)</h2>
          <form onSubmit={handleAdjust} className="grid grid-cols-1 gap-3 sm:grid-cols-6 items-end">
            <div className="sm:col-span-2">
              <Label>Medicine Batch</Label>
              <Select value={selectedBatch} onChange={(e) => setSelectedBatch(e.target.value)}>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.medicine_name} ({b.batch_number} · Avail {b.quantity_available})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Txn Type</Label>
              <Select value={txnType} onChange={(e) => setTxnType(e.target.value)}>
                <option value="PURCHASE_RECEIPT">Purchase Receipt (+)</option>
                <option value="RETURN_RESTOCK">Return Restock (+)</option>
                <option value="EXPIRED_WRITEOFF">Expired Write-off (−)</option>
                <option value="DAMAGED_WRITEOFF">Damaged Write-off (−)</option>
                <option value="MANUAL_ADJUSTMENT">Manual Adjustment (±)</option>
              </Select>
            </div>
            <div>
              <Label>Qty Delta</Label>
              <Input type="number" required value={delta} onChange={(e) => setDelta(e.target.value)} />
            </div>
            <div>
              <Label>Mandatory Reason</Label>
              <Input required value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Audit count / damaged strip" />
            </div>
            <Button type="submit">Apply Adjustment</Button>
          </form>
        </Card>

        {/* Quarantine Dialog */}
        {quarantineTarget && (
          <Card className="p-4 border-[#D71920]">
            <form onSubmit={submitQuarantine} className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px]">
                <Label>
                  {quarantineTarget.is_quarantined ? 'Release Quarantine Reason' : 'Quarantine Reason'} — {quarantineTarget.medicine_name} ({quarantineTarget.batch_number})
                </Label>
                <Input
                  required
                  value={quarantineReason}
                  onChange={(e) => setQuarantineReason(e.target.value)}
                  placeholder="Document recall, seal damage, or inspection clearance"
                />
              </div>
              <Button type="submit" variant={quarantineTarget.is_quarantined ? 'secondary' : 'destructive'}>
                {quarantineTarget.is_quarantined ? 'Release Batch' : 'Confirm Quarantine'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setQuarantineTarget(null)}>Cancel</Button>
            </form>
          </Card>
        )}

        {/* FEFO Batch Table */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-bold">Store Batches (FEFO Allocation Order)</h2>
          <Table>
            <thead>
              <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                <th className="py-2 font-medium">Medicine</th>
                <th className="py-2 font-medium">Batch / Supplier</th>
                <th className="py-2 font-medium">Mfg / Expiry</th>
                <th className="py-2 text-right font-medium">Avail / Resv / Dmg</th>
                <th className="py-2 text-right font-medium">Cost / MRP</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 text-right font-medium">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB] text-xs">
              {filteredBatches.map((b) => {
                const isExpired = b.days_to_expiry <= 0;
                const isQuarantined = Boolean(b.is_quarantined);
                return (
                  <tr key={b.id}>
                    <td className="py-2.5">
                      <div className="font-semibold">{b.medicine_name}</div>
                      <div className="text-[11px] text-[#526071]">{b.storage_conditions || 'Standard'}</div>
                    </td>
                    <td className="py-2.5">
                      <div className="font-mono">{b.batch_number}</div>
                      <div className="text-[11px] text-[#526071]">{b.supplier_name || '—'}</div>
                    </td>
                    <td className="py-2.5 tabular-nums">
                      <div className="text-[11px] text-[#526071]">Mfg: {b.mfg_date || '—'}</div>
                      <div className={isExpired ? 'font-bold text-[#D71920]' : b.days_to_expiry <= 60 ? 'font-bold text-[#D97706]' : ''}>
                        Exp: {b.expiry_date} ({b.days_to_expiry}d)
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      <span className={b.quantity_available <= 20 ? 'font-bold text-[#D71920]' : 'font-bold'}>
                        {b.quantity_available}
                      </span>{' '}
                      / {b.quantity_reserved} / {b.quantity_damaged + b.quantity_expired}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      <div>{formatINRPaise(b.purchase_price_paise)}</div>
                      <div className="text-[11px] text-[#526071]">MRP {formatINRPaise(b.mrp_paise)}</div>
                    </td>
                    <td className="py-2.5 font-semibold">
                      {isQuarantined ? (
                        <span className="text-[#D71920]">QUARANTINED</span>
                      ) : isExpired ? (
                        <span className="text-[#D71920]">EXPIRED (Blocked)</span>
                      ) : (
                        <span className="text-[#16835D]">SELLABLE</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setQuarantineTarget(b);
                          setQuarantineReason('');
                        }}
                      >
                        {isQuarantined ? 'Release' : 'Quarantine'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        {/* Auditable Inventory Movement History */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-bold">Auditable Inventory Movement Ledger</h2>
          <Table>
            <thead>
              <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                <th className="py-2 font-medium">Timestamp</th>
                <th className="py-2 font-medium">Medicine & Batch</th>
                <th className="py-2 font-medium">Transaction</th>
                <th className="py-2 text-right font-medium">Delta</th>
                <th className="py-2 font-medium">Staff / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB] text-xs">
              {txns.map((t) => (
                <tr key={t.id}>
                  <td className="py-2 text-[#526071] tabular-nums">{formatIndianDateTime(t.created_at)}</td>
                  <td className="py-2 font-medium">{t.medicine_name} ({t.batch_number})</td>
                  <td className="py-2 font-mono">{t.txn_type}</td>
                  <td className={`py-2 text-right font-bold tabular-nums ${t.quantity_delta >= 0 ? 'text-[#16835D]' : 'text-[#D71920]'}`}>
                    {t.quantity_delta >= 0 ? `+${t.quantity_delta}` : t.quantity_delta}
                  </td>
                  <td className="py-2 text-[#526071]">
                    {t.notes || '—'} {t.performed_by_name ? `(${t.performed_by_name})` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// 2. MEDICINES MANAGEMENT (24 FIELDS, DRAFTS, DUPLICATE, ARCHIVE, MULTI-IMAGE)
// ===========================================================================
interface AdminMedRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  generic_name: string;
  brand: string | null;
  strength: string | null;
  composition: string;
  category_id: string;
  category_name: string;
  subcategory_id: string | null;
  subcategory_name: string | null;
  manufacturer_id: string;
  manufacturer_name: string;
  dosage_form: string;
  pack_size: string;
  schedule_type: 'OTC' | 'Schedule H' | 'Schedule H1';
  requires_prescription: number;
  hsn_code: string | null;
  gst_percent: number;
  mrp_paise: number;
  sale_price_paise: number;
  usage_summary: string | null;
  storage_instructions: string | null;
  is_active: number;
  publication_status: PublicationStatus;
  is_featured: number;
  is_essential: number;
  is_pharmacist_approved: number;
  is_recalled: number;
  online_sale_restricted: number;
  total_stock: number;
  images: Array<{ id: string; image_url: string; is_primary: number }>;
}

export function AdminMedicinesPage() {
  const { user, showToast } = useApp();
  const [meds, setMeds] = useState<AdminMedRow[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [subcategories, setSubcategories] = useState<Array<{ id: string; category_id: string; name: string }>>([]);
  const [manufacturers, setManufacturers] = useState<Array<{ id: string; name: string }>>([]);

  const [pubFilter, setPubFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [editingMed, setEditingMed] = useState<AdminMedRow | null>(null);
  const [showForm, setShowForm] = useState(false);

  const canApprove = user?.roles.some((r) => r === Role.PHARMACIST || r === Role.SUPER_ADMIN) ?? false;

  const [form, setForm] = useState({
    name: '',
    genericName: '',
    brand: '',
    strength: '',
    composition: '',
    manufacturerId: '',
    manufacturerName: '',
    categoryId: '',
    subcategoryId: '',
    dosageForm: 'Tablet',
    packSize: 'Strip of 10 Tablets',
    sku: '',
    barcode: '',
    hsnCode: '30049099',
    gstPercent: '12',
    scheduleType: 'OTC' as 'OTC' | 'Schedule H' | 'Schedule H1',
    requiresPrescription: false,
    onlineSaleRestricted: false,
    mrpRupees: '95',
    salePriceRupees: '82',
    usageSummary: '',
    storageInstructions: 'Store below 25°C away from moisture',
    initialStock: '40',
    batchNumber: 'BATCH-NEW-01',
    expiryDate: '2028-06-30',
    publicationStatus: 'DRAFT' as 'DRAFT' | 'PUBLISHED',
    isFeatured: false,
    isEssential: false,
    isPharmacistApproved: false,
  });

  const load = () => {
    apiFetch<{ medicines: AdminMedRow[]; manufacturers: typeof manufacturers }>('/api/admin/medicines')
      .then((d) => {
        setMeds(d.medicines);
        setManufacturers(d.manufacturers);
        if (editingMed) {
          const refreshed = d.medicines.find((m) => m.id === editingMed.id);
          if (refreshed) setEditingMed(refreshed);
        }
      })
      .catch(console.error);
    apiFetch<{ categories: Array<{ id: string; name: string }>; subcategories: typeof subcategories }>('/api/admin/categories')
      .then((d) => {
        setCategories(d.categories);
        setSubcategories(d.subcategories);
        if (!form.categoryId && d.categories.length > 0) {
          setForm((prev) => ({ ...prev, categoryId: d.categories[0].id }));
        }
      })
      .catch(console.error);
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingMed(null);
    setForm({
      name: '',
      genericName: '',
      brand: '',
      strength: '',
      composition: '',
      manufacturerId: manufacturers[0]?.id || '',
      manufacturerName: '',
      categoryId: categories[0]?.id || '',
      subcategoryId: '',
      dosageForm: 'Tablet',
      packSize: 'Strip of 10 Tablets',
      sku: '',
      barcode: '',
      hsnCode: '30049099',
      gstPercent: '12',
      scheduleType: 'OTC',
      requiresPrescription: false,
      onlineSaleRestricted: false,
      mrpRupees: '95',
      salePriceRupees: '82',
      usageSummary: '',
      storageInstructions: 'Store below 25°C away from moisture',
      initialStock: '40',
      batchNumber: 'BATCH-NEW-01',
      expiryDate: '2028-06-30',
      publicationStatus: 'DRAFT',
      isFeatured: false,
      isEssential: false,
      isPharmacistApproved: canApprove,
    });
    setShowForm(true);
  };

  const openEdit = (m: AdminMedRow) => {
    setEditingMed(m);
    setForm({
      name: m.name,
      genericName: m.generic_name,
      brand: m.brand || '',
      strength: m.strength || '',
      composition: m.composition,
      manufacturerId: m.manufacturer_id,
      manufacturerName: '',
      categoryId: m.category_id,
      subcategoryId: m.subcategory_id || '',
      dosageForm: m.dosage_form,
      packSize: m.pack_size,
      sku: m.sku,
      barcode: m.barcode || '',
      hsnCode: m.hsn_code || '',
      gstPercent: String(m.gst_percent),
      scheduleType: m.schedule_type,
      requiresPrescription: Boolean(m.requires_prescription),
      onlineSaleRestricted: Boolean(m.online_sale_restricted),
      mrpRupees: String(Math.round(m.mrp_paise / 100)),
      salePriceRupees: String(Math.round(m.sale_price_paise / 100)),
      usageSummary: m.usage_summary || '',
      storageInstructions: m.storage_instructions || '',
      initialStock: String(m.total_stock),
      batchNumber: '',
      expiryDate: '2028-06-30',
      publicationStatus: m.publication_status === 'ARCHIVED' ? 'DRAFT' : m.publication_status,
      isFeatured: Boolean(m.is_featured),
      isEssential: Boolean(m.is_essential),
      isPharmacistApproved: Boolean(m.is_pharmacist_approved),
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: form.name,
        genericName: form.genericName,
        brand: form.brand || null,
        strength: form.strength || null,
        composition: form.composition,
        categoryId: form.categoryId,
        subcategoryId: form.subcategoryId || null,
        manufacturerId: form.manufacturerName ? undefined : form.manufacturerId || undefined,
        manufacturerName: form.manufacturerName || undefined,
        dosageForm: form.dosageForm,
        packSize: form.packSize,
        sku: form.sku || undefined,
        barcode: form.barcode || null,
        hsnCode: form.hsnCode || null,
        gstPercent: Number(form.gstPercent),
        scheduleType: form.scheduleType,
        requiresPrescription: form.requiresPrescription,
        onlineSaleRestricted: form.onlineSaleRestricted,
        mrpPaise: Math.round(Number(form.mrpRupees) * 100),
        salePricePaise: Math.round(Number(form.salePriceRupees) * 100),
        usageSummary: form.usageSummary || null,
        storageInstructions: form.storageInstructions || null,
        publicationStatus: form.publicationStatus,
        isFeatured: form.isFeatured,
        isEssential: form.isEssential,
        isPharmacistApproved: form.isPharmacistApproved,
      };

      if (editingMed) {
        await apiFetch(`/api/admin/medicines/${editingMed.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast('Medicine updated');
      } else {
        await apiFetch('/api/admin/medicines', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            initialStock: Number(form.initialStock),
            batchNumber: form.batchNumber || 'NEW-BATCH-01',
            expiryDate: form.expiryDate,
          }),
        });
        showToast('Medicine created');
      }
      setShowForm(false);
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to save medicine', 'error');
    }
  };

  const patchMed = async (id: string, body: Record<string, unknown>, msg: string) => {
    try {
      await apiFetch(`/api/admin/medicines/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      showToast(msg);
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await apiFetch(`/api/admin/medicines/${id}/duplicate`, { method: 'POST' });
      showToast('Product duplicated as DRAFT');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Duplicate failed', 'error');
    }
  };

  const handleArchive = async (id: string) => {
    try {
      await apiFetch(`/api/admin/medicines/${id}/archive`, { method: 'POST' });
      showToast('Medicine archived');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Archive failed', 'error');
    }
  };

  const handleImageDropOrPick = async (medId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    Array.from(files).slice(0, 6).forEach((f) => fd.append('files', f));
    try {
      const res = await fetch(`/api/admin/medicines/${medId}/images`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) throw new Error('Image upload failed');
      showToast('Product photos uploaded');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return meds.filter((m) => {
      if (pubFilter !== 'ALL' && m.publication_status !== pubFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.generic_name.toLowerCase().includes(q) ||
        m.sku.toLowerCase().includes(q) ||
        (m.barcode || '').toLowerCase().includes(q)
      );
    });
  }, [meds, pubFilter, search]);

  return (
    <AdminLayout title="Medicine Catalogue Management">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#526071]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, generic, SKU..." className="pl-9" />
            </div>
            {['ALL', 'PUBLISHED', 'DRAFT', 'ARCHIVED'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setPubFilter(st)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  pubFilter === st ? 'bg-[#D71920] text-white' : 'bg-white border border-[#E1E5EB] text-[#526071]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a href="/api/admin/medicines/export?format=csv">
              <Button variant="outline" size="sm">
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </a>
            <a href="/api/admin/medicines/export?format=xlsx">
              <Button variant="outline" size="sm">
                <Download className="h-3.5 w-3.5" />
                Export XLSX
              </Button>
            </a>
            <Link to="/admin/bulk-import">
              <Button variant="outline" size="sm">
                <Upload className="h-3.5 w-3.5" />
                Bulk Import
              </Button>
            </Link>
            <Button onClick={openCreate}>+ Add Medicine</Button>
          </div>
        </div>

        {/* 24-Field Product Form + Drag & Drop Images + Live Preview */}
        {showForm && (
          <Card className="p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-[#E1E5EB] pb-3">
              <h2 className="text-base font-bold">
                {editingMed ? `Edit Medicine — ${editingMed.name}` : 'Create New Medicine Listing'}
              </h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-[#526071] hover:text-[#202630]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2"><Label>Product Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Brand</Label><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></div>
                <div><Label>Generic Name *</Label><Input required value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} /></div>
                <div className="sm:col-span-2"><Label>Composition *</Label><Input required value={form.composition} onChange={(e) => setForm({ ...form, composition: e.target.value })} /></div>
                <div>
                  <Label>Manufacturer</Label>
                  <Select value={form.manufacturerId} onChange={(e) => setForm({ ...form, manufacturerId: e.target.value })}>
                    {manufacturers.map((mf) => (
                      <option key={mf.id} value={mf.id}>{mf.name}</option>
                    ))}
                  </Select>
                </div>
                <div><Label>Or New Manufacturer</Label><Input value={form.manufacturerName} onChange={(e) => setForm({ ...form, manufacturerName: e.target.value })} placeholder="Optional custom" /></div>
                <div>
                  <Label>Category *</Label>
                  <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value, subcategoryId: '' })}>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Subcategory</Label>
                  <Select value={form.subcategoryId} onChange={(e) => setForm({ ...form, subcategoryId: e.target.value })}>
                    <option value="">None</option>
                    {subcategories
                      .filter((s) => s.category_id === form.categoryId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                  </Select>
                </div>
                <div><Label>Medicine Form *</Label><Input required value={form.dosageForm} onChange={(e) => setForm({ ...form, dosageForm: e.target.value })} /></div>
                <div><Label>Strength</Label><Input value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} placeholder="e.g. 500 mg" /></div>
                <div><Label>Pack Size *</Label><Input required value={form.packSize} onChange={(e) => setForm({ ...form, packSize: e.target.value })} /></div>
                <div><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Auto if blank" disabled={Boolean(editingMed)} /></div>
                <div><Label>Barcode</Label><Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
                <div><Label>HSN Code</Label><Input value={form.hsnCode} onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} /></div>
                <div><Label>GST Tax %</Label><Input type="number" value={form.gstPercent} onChange={(e) => setForm({ ...form, gstPercent: e.target.value })} /></div>
                <div><Label>MRP (INR) *</Label><Input type="number" required value={form.mrpRupees} onChange={(e) => setForm({ ...form, mrpRupees: e.target.value })} /></div>
                <div><Label>Selling Price (INR) *</Label><Input type="number" required value={form.salePriceRupees} onChange={(e) => setForm({ ...form, salePriceRupees: e.target.value })} /></div>
                <div>
                  <Label>Regulatory Classification</Label>
                  <Select
                    value={form.scheduleType}
                    onChange={(e) => {
                      const val = e.target.value as 'OTC' | 'Schedule H' | 'Schedule H1';
                      setForm({ ...form, scheduleType: val, requiresPrescription: val !== 'OTC' });
                    }}
                  >
                    <option value="OTC">OTC</option>
                    <option value="Schedule H">Schedule H</option>
                    <option value="Schedule H1">Schedule H1</option>
                  </Select>
                </div>
                <div>
                  <Label>Publication Status</Label>
                  <Select
                    value={form.publicationStatus}
                    onChange={(e) => setForm({ ...form, publicationStatus: e.target.value as 'DRAFT' | 'PUBLISHED' })}
                  >
                    <option value="DRAFT">Draft (Staff Review)</option>
                    <option value="PUBLISHED" disabled={!canApprove && !editingMed?.is_pharmacist_approved}>
                      Published (Live Storefront)
                    </option>
                  </Select>
                </div>
                {!editingMed && (
                  <>
                    <div><Label>Opening Stock</Label><Input type="number" value={form.initialStock} onChange={(e) => setForm({ ...form, initialStock: e.target.value })} /></div>
                    <div><Label>Opening Batch #</Label><Input value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} /></div>
                    <div><Label>Batch Expiry</Label><Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></div>
                  </>
                )}
                <div className="sm:col-span-3"><Label>Storage Instructions</Label><Input value={form.storageInstructions} onChange={(e) => setForm({ ...form, storageInstructions: e.target.value })} /></div>
                <div className="sm:col-span-3"><Label>Product Description / Usage Summary</Label><Textarea value={form.usageSummary} onChange={(e) => setForm({ ...form, usageSummary: e.target.value })} /></div>

                <div className="sm:col-span-3 flex flex-wrap gap-4 text-xs pt-1">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={form.requiresPrescription} onChange={(e) => setForm({ ...form, requiresPrescription: e.target.checked })} />
                    Prescription Required
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={form.onlineSaleRestricted} onChange={(e) => setForm({ ...form, onlineSaleRestricted: e.target.checked })} />
                    Restrict Online Sale
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={form.isFeatured} onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })} />
                    Homepage Featured
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={form.isEssential} onChange={(e) => setForm({ ...form, isEssential: e.target.checked })} />
                    Pharmacy Essential
                  </label>
                  {canApprove && (
                    <label className="flex items-center gap-1.5 font-semibold text-[#16835D]">
                      <input type="checkbox" checked={form.isPharmacistApproved} onChange={(e) => setForm({ ...form, isPharmacistApproved: e.target.checked })} />
                      Pharmacist Approved
                    </label>
                  )}
                </div>

                <div className="sm:col-span-3 pt-2 flex gap-2">
                  <Button type="submit">{editingMed ? 'Save Changes' : 'Create Product'}</Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </div>

              {/* Right column: Product Preview & Multi-Image Drag-and-Drop */}
              <div className="lg:col-span-4 space-y-4">
                <div className="rounded-lg border border-[#E1E5EB] bg-[#F5F7FA] p-4 space-y-2">
                  <div className="text-[11px] font-bold uppercase text-[#526071]">Customer Card Preview</div>
                  <div className="rounded-lg border border-[#E1E5EB] bg-white p-3.5 space-y-1.5">
                    <div className="text-xs font-semibold text-[#D71920]">{form.scheduleType}</div>
                    <div className="text-sm font-bold text-[#202630]">{form.name || 'Medicine Name'}</div>
                    <div className="text-xs text-[#526071]">
                      {form.strength ? `${form.strength} · ` : ''}{form.packSize}
                    </div>
                    <div className="pt-1 flex items-baseline gap-2">
                      <span className="text-base font-bold tabular-nums">₹{form.salePriceRupees || 0}</span>
                      <span className="text-xs line-through text-[#526071] tabular-nums">MRP ₹{form.mrpRupees || 0}</span>
                    </div>
                  </div>
                </div>

                {editingMed && (
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleImageDropOrPick(editingMed.id, e.dataTransfer.files);
                    }}
                    className="rounded-lg border-2 border-dashed border-[#CBD2D9] bg-[#F5F7FA] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">Product Photographs ({editingMed.images.length})</span>
                      <label className="inline-flex items-center gap-1 text-xs font-semibold text-[#D71920] cursor-pointer">
                        <ImagePlus className="h-3.5 w-3.5" />
                        Upload Files
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageDropOrPick(editingMed.id, e.target.files)}
                        />
                      </label>
                    </div>
                    <p className="text-[11px] text-[#526071]">Drag and drop JPG/PNG/WEBP product photos here.</p>
                    <div className="grid grid-cols-3 gap-2">
                      {editingMed.images.map((im) => (
                        <div key={im.id} className="relative rounded border border-[#E1E5EB] bg-white p-1">
                          <img src={im.image_url} alt="" className="h-16 w-full object-contain" />
                          <div className="mt-1 flex items-center justify-between text-[10px]">
                            <button
                              type="button"
                              onClick={() => apiFetch(`/api/admin/medicines/${editingMed.id}/images/${im.id}/primary`, { method: 'PATCH' }).then(() => load())}
                              className={im.is_primary ? 'font-bold text-[#16835D]' : 'text-[#526071] hover:underline'}
                            >
                              {im.is_primary ? 'Primary' : 'Set Main'}
                            </button>
                            <button
                              type="button"
                              onClick={() => apiFetch(`/api/admin/medicines/${editingMed.id}/images/${im.id}`, { method: 'DELETE' }).then(() => load())}
                              className="text-[#D71920]"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </form>
          </Card>
        )}

        <Card className="p-0 overflow-hidden">
          <Table>
            <thead className="bg-[#F5F7FA] border-b border-[#E1E5EB] text-xs text-[#526071]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Medicine</th>
                <th className="px-4 py-2.5 font-medium">Category & Schedule</th>
                <th className="px-4 py-2 text-right font-medium">Sale / MRP</th>
                <th className="px-4 py-2 text-right font-medium">Stock</th>
                <th className="px-4 py-2 font-medium">Publication & Approval</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB] text-xs">
              {filtered.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[#202630]">{m.name}</div>
                    <div className="text-[11px] text-[#526071]">
                      {m.generic_name} · {m.sku} {m.barcode ? `· ${m.barcode}` : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{m.category_name}</div>
                    <div className="text-[11px] text-[#526071]">
                      {m.schedule_type} {m.requires_prescription ? '(Rx)' : '(OTC)'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div className="font-bold">{formatINRPaise(m.sale_price_paise)}</div>
                    <div className="text-[11px] text-[#526071]">MRP {formatINRPaise(m.mrp_paise)}</div>
                  </td>
                  <td className={`px-4 py-3 text-right font-bold tabular-nums ${m.total_stock <= 15 ? 'text-[#D71920]' : ''}`}>
                    {m.total_stock}
                  </td>
                  <td className="px-4 py-3 space-y-1">
                    <div className="font-semibold">
                      <span
                        className={
                          m.publication_status === 'PUBLISHED'
                            ? 'text-[#16835D]'
                            : m.publication_status === 'ARCHIVED'
                              ? 'text-[#526071]'
                              : 'text-[#D97706]'
                        }
                      >
                        {m.publication_status}
                      </span>
                      {m.is_recalled ? ' · RECALLED' : ''}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {canApprove && !m.is_pharmacist_approved && (
                        <button
                          type="button"
                          onClick={() => patchMed(m.id, { isPharmacistApproved: true, publicationStatus: 'PUBLISHED' }, 'Approved & Published')}
                          className="text-[#16835D] font-semibold hover:underline cursor-pointer"
                        >
                          Approve & Publish
                        </button>
                      )}
                      {!m.is_pharmacist_approved && !canApprove && (
                        <span className="text-[#D97706]">Awaiting Pharmacist Approval</span>
                      )}
                      {m.is_pharmacist_approved === 1 && m.publication_status !== 'ARCHIVED' && (
                        <button
                          type="button"
                          onClick={() =>
                            patchMed(
                              m.id,
                              { publicationStatus: m.publication_status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED' },
                              m.publication_status === 'PUBLISHED' ? 'Unpublished to Draft' : 'Published Live'
                            )
                          }
                          className="text-[#526071] hover:underline cursor-pointer"
                        >
                          {m.publication_status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                    <Button variant="outline" size="sm" onClick={() => openEdit(m)}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" title="Duplicate as Draft" onClick={() => handleDuplicate(m.id)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {m.publication_status !== 'ARCHIVED' && (
                      <Button variant="outline" size="sm" onClick={() => handleArchive(m.id)}>
                        Archive
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// 3. CATEGORIES & SUBCATEGORIES MANAGEMENT (REORDER, SEO, FEATURED, BANNER)
// ===========================================================================
export function AdminCategoriesPage() {
  const { showToast } = useApp();
  const [categories, setCategories] = useState<
    Array<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      icon_name: string | null;
      banner_url: string | null;
      seo_description: string | null;
      is_featured: number;
      is_active: number;
      display_order: number;
      medicine_count: number;
    }>
  >([]);
  const [subcategories, setSubcategories] = useState<
    Array<{ id: string; category_id: string; name: string; is_active: number }>
  >([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState('');
  const [editingCat, setEditingCat] = useState<(typeof categories)[0] | null>(null);

  const load = () => {
    apiFetch<{ categories: typeof categories; subcategories: typeof subcategories }>('/api/admin/categories')
      .then((d) => {
        setCategories(d.categories);
        setSubcategories(d.subcategories);
      })
      .catch(console.error);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name, description: description || undefined, parentCategoryId: parentId || undefined }),
      });
      showToast(parentId ? 'Subcategory added' : 'Category added');
      setName('');
      setDescription('');
      setParentId('');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to create category', 'error');
    }
  };

  const moveOrder = async (idx: number, dir: -1 | 1) => {
    const next = [...categories];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    const tmp = next[idx];
    next[idx] = next[swapIdx];
    next[swapIdx] = tmp;
    await apiFetch('/api/admin/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds: next.map((c) => c.id) }),
    });
    load();
  };

  const handleUpdateCat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCat) return;
    await apiFetch(`/api/admin/categories/${editingCat.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: editingCat.name,
        description: editingCat.description,
        iconName: editingCat.icon_name,
        seoDescription: editingCat.seo_description,
        isFeatured: Boolean(editingCat.is_featured),
        isActive: Boolean(editingCat.is_active),
      }),
    });
    showToast('Category updated');
    setEditingCat(null);
    load();
  };

  const uploadBanner = async (catId: string, file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/admin/categories/${catId}/banner`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (res.ok) {
      showToast('Category banner uploaded');
      load();
    }
  };

  return (
    <AdminLayout title="Pharmacy Categories & Subcategories">
      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-bold">Add Category or Subcategory</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end">
            <div><Label>Name</Label><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Cold Chain Insulins" /></div>
            <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <div>
              <Label>Parent Category (optional)</Label>
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">Top-Level Category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <Button type="submit">Add</Button>
          </form>
        </Card>

        {editingCat && (
          <Card className="p-5 border-[#D71920]">
            <h2 className="mb-3 text-sm font-bold">Edit Category — {editingCat.name}</h2>
            <form onSubmit={handleUpdateCat} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div><Label>Name</Label><Input required value={editingCat.name} onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })} /></div>
              <div><Label>Icon Name (Lucide)</Label><Input value={editingCat.icon_name || ''} onChange={(e) => setEditingCat({ ...editingCat, icon_name: e.target.value })} placeholder="pill, heart-pulse..." /></div>
              <div><Label>Description</Label><Input value={editingCat.description || ''} onChange={(e) => setEditingCat({ ...editingCat, description: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>SEO Meta Description</Label><Input value={editingCat.seo_description || ''} onChange={(e) => setEditingCat({ ...editingCat, seo_description: e.target.value })} /></div>
              <div className="flex items-center gap-4 text-xs pb-2">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={Boolean(editingCat.is_featured)} onChange={(e) => setEditingCat({ ...editingCat, is_featured: e.target.checked ? 1 : 0 })} />
                  Featured
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={Boolean(editingCat.is_active)} onChange={(e) => setEditingCat({ ...editingCat, is_active: e.target.checked ? 1 : 0 })} />
                  Active
                </label>
              </div>
              <div className="sm:col-span-3 flex gap-2">
                <Button type="submit">Save Category</Button>
                <Button type="button" variant="outline" onClick={() => setEditingCat(null)}>Cancel</Button>
              </div>
            </form>
          </Card>
        )}

        <Card className="p-0 overflow-hidden">
          <Table>
            <thead className="bg-[#F5F7FA] border-b border-[#E1E5EB] text-xs text-[#526071]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Order</th>
                <th className="px-4 py-2.5 font-medium">Category & Subcategories</th>
                <th className="px-4 py-2.5 font-medium">SEO / Status</th>
                <th className="px-4 py-2.5 text-right font-medium">SKUs</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB] text-xs">
              {categories.map((c, idx) => {
                const subs = subcategories.filter((s) => s.category_id === c.id);
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => moveOrder(idx, -1)} className="p-1 rounded hover:bg-[#F5F7FA] cursor-pointer"><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => moveOrder(idx, 1)} className="p-1 rounded hover:bg-[#F5F7FA] cursor-pointer"><ArrowDown className="h-3.5 w-3.5" /></button>
                        <span className="tabular-nums text-[#526071]">#{idx + 1}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-[#202630]">{c.name}</div>
                      <div className="text-[11px] text-[#526071]">{c.description || '—'}</div>
                      {subs.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                          {subs.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => apiFetch(`/api/admin/subcategories/${s.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !s.is_active }) }).then(() => load())}
                              className={`underline cursor-pointer ${s.is_active ? 'text-[#16835D]' : 'text-[#526071] line-through'}`}
                            >
                              {s.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className={c.is_active ? 'font-semibold text-[#16835D]' : 'font-semibold text-[#D71920]'}>
                        {c.is_active ? 'Active' : 'Inactive'} {c.is_featured ? '· Featured' : ''}
                      </div>
                      <div className="text-[11px] text-[#526071] truncate max-w-[200px]">{c.seo_description || 'No SEO summary'}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{c.medicine_count}</td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <label className="inline-block text-xs font-medium text-[#526071] hover:text-[#202630] cursor-pointer">
                        Banner
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadBanner(c.id, e.target.files?.[0])} />
                      </label>
                      <Button variant="outline" size="sm" onClick={() => setEditingCat(c)}>Edit</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// 4. CUSTOMERS MANAGEMENT (WITH STRICT CLINICAL RX ACCESS RBAC)
// ===========================================================================
interface CustomerSummary {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  loyalty_points: number;
  allergies_note: string | null;
  order_count: number;
  total_spent_paise: number;
  ticket_count: number;
  created_at: string;
}

interface CustomerDetailPayload {
  customer: CustomerSummary;
  orders: Array<{ id: string; order_number: string; status: string; total_paise: number; created_at: string }>;
  tickets: Array<{ id: string; subject: string; message: string; status: string; created_at: string }>;
  refunds: Array<{ id: string; order_number: string; reason: string; amount_paise: number; status: string }>;
  prescriptions: Array<{ id: string; patient_name: string; doctor_name: string | null; status: string; file_url: string; signed_file_url?: string; created_at: string }>;
  rxAccessRestricted: boolean;
}

export function AdminCustomersPage() {
  const { showToast } = useApp();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<CustomerDetailPayload | null>(null);

  useEffect(() => {
    apiFetch<{ customers: CustomerSummary[] }>('/api/admin/customers')
      .then((d) => setCustomers(d.customers))
      .catch(console.error);
  }, []);

  const inspectCustomer = (id: string) => {
    apiFetch<CustomerDetailPayload>(`/api/admin/customers/${id}`)
      .then(setDetail)
      .catch((err) => showToast(err instanceof Error ? err.message : 'Unable to load customer', 'error'));
  };

  const filtered = customers.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.full_name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q);
  });

  return (
    <AdminLayout title="Customer Management & Clinical Privacy">
      <div className="space-y-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#526071]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer name, email, phone" className="pl-9" />
        </div>

        <Card className="p-0 overflow-hidden">
          <Table>
            <thead className="bg-[#F5F7FA] border-b border-[#E1E5EB] text-xs text-[#526071]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Contact</th>
                <th className="px-4 py-2.5 text-right font-medium">Orders</th>
                <th className="px-4 py-2.5 text-right font-medium">Lifetime Spend</th>
                <th className="px-4 py-2.5 text-right font-medium">Tickets</th>
                <th className="px-4 py-2.5 text-right font-medium">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB] text-xs">
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-semibold">{c.full_name}</td>
                  <td className="px-4 py-3 text-[#526071]">{c.phone} · {c.email}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.order_count}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatINRPaise(c.total_spent_paise)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.ticket_count}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" size="sm" onClick={() => inspectCustomer(c.id)}>
                      View Profile
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="w-full max-w-xl bg-white h-full overflow-y-auto border-l border-[#E1E5EB] p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-[#E1E5EB] pb-3">
              <div>
                <h2 className="text-lg font-bold">{detail.customer.full_name}</h2>
                <div className="text-xs text-[#526071]">{detail.customer.phone} · {detail.customer.email}</div>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="text-[#526071]"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold">Order History ({detail.orders.length})</div>
              {detail.orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded border border-[#E1E5EB] px-3 py-2 text-xs">
                  <div>
                    <Link to={`/admin/orders/${o.id}`} className="font-mono font-bold text-[#D71920] hover:underline">{o.order_number}</Link>
                    <span className="text-[#526071]"> · {o.status}</span>
                  </div>
                  <span className="font-semibold tabular-nums">{formatINRPaise(o.total_paise)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold">Prescriptions (Role-Restricted)</div>
              {detail.rxAccessRestricted ? (
                <div className="flex items-center gap-2 rounded border border-[#E1E5EB] bg-[#F5F7FA] p-3 text-xs text-[#526071]">
                  <ShieldCheck className="h-4 w-4 text-[#D71920]" />
                  <span>Clinical prescription documents are masked for Inventory Manager role.</span>
                </div>
              ) : detail.prescriptions.length === 0 ? (
                <p className="text-xs text-[#526071]">No prescriptions submitted.</p>
              ) : (
                detail.prescriptions.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded border border-[#E1E5EB] px-3 py-2 text-xs">
                    <div>
                      <span className="font-semibold">{p.patient_name}</span> · {p.status}
                    </div>
                    <a href={p.signed_file_url || p.file_url} target="_blank" rel="noopener noreferrer" className="text-[#D71920] hover:underline">View File</a>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold">Support Tickets & Refunds</div>
              {detail.tickets.map((t) => (
                <div key={t.id} className="rounded border border-[#E1E5EB] p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{t.subject}</span>
                    <Select
                      value={t.status}
                      onChange={(e) =>
                        apiFetch(`/api/admin/support-tickets/${t.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: e.target.value }),
                        }).then(() => inspectCustomer(detail.customer.id))
                      }
                      className="h-7 w-32 text-xs"
                    >
                      <option value="OPEN">OPEN</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="RESOLVED">RESOLVED</option>
                    </Select>
                  </div>
                  <div className="text-[#526071]">{t.message}</div>
                </div>
              ))}
              {detail.refunds.map((r) => (
                <div key={r.id} className="rounded border border-[#E1E5EB] p-3 text-xs flex justify-between">
                  <div><span className="font-mono font-bold">{r.order_number}</span> · {r.reason}</div>
                  <span className="font-semibold">{r.status} · {formatINRPaise(r.amount_paise)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
