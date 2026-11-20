import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  Bike,
  CheckCircle2,
  ShieldAlert,
  Camera,
  Edit3,
  BarChart3,
  IndianRupee,
} from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout.tsx';
import { Button, Card, Input, Label, Select, Table } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { formatIndianDateTime, formatINRPaise, type PublicStoreInfo } from '../../shared/types.ts';

// ===========================================================================
// 1. DELIVERY PARTNER CONTROL PANEL
// ===========================================================================
interface DeliveryPartnerRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  vehicle_type: string;
  vehicle_number: string;
  photo_url: string | null;
  account_status: 'ACTIVE' | 'SUSPENDED';
  is_available: number;
  is_on_shift: number;
  active_assignments: number;
  completed_deliveries: number;
  failed_deliveries: number;
  avg_delivery_mins: number | null;
  pending_cod_paise: number;
}

export function AdminDeliveryPartnersPage() {
  const { showToast } = useApp();
  const [partners, setPartners] = useState<DeliveryPartnerRow[]>([]);
  const [partnerForm, setPartnerForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    vehicleType: 'Two-Wheeler',
    vehicleNumber: '',
  });
  const [editing, setEditing] = useState<DeliveryPartnerRow | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: '',
    phone: '',
    vehicleType: '',
    vehicleNumber: '',
    accountStatus: 'ACTIVE' as 'ACTIVE' | 'SUSPENDED',
    isOnShift: true,
    isAvailable: true,
  });

  const load = () => {
    apiFetch<{ deliveryPartners: DeliveryPartnerRow[] }>('/api/admin/delivery-partners')
      .then((d) => setPartners(d.deliveryPartners))
      .catch(console.error);
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/delivery-partners', {
        method: 'POST',
        body: JSON.stringify(partnerForm),
      });
      showToast('Delivery partner account provisioned');
      setPartnerForm({ fullName: '', email: '', phone: '', password: '', vehicleType: 'Two-Wheeler', vehicleNumber: '' });
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to create partner', 'error');
    }
  };

  const startEdit = (p: DeliveryPartnerRow) => {
    setEditing(p);
    setEditForm({
      fullName: p.full_name,
      phone: p.phone,
      vehicleType: p.vehicle_type,
      vehicleNumber: p.vehicle_number,
      accountStatus: p.account_status || 'ACTIVE',
      isOnShift: Boolean(p.is_on_shift),
      isAvailable: Boolean(p.is_available),
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await apiFetch(`/api/admin/delivery-partners/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      });
      showToast('Delivery partner profile updated');
      setEditing(null);
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleToggleSuspend = async (p: DeliveryPartnerRow) => {
    const next = p.account_status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    try {
      await apiFetch(`/api/admin/delivery-partners/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ accountStatus: next, isOnShift: next === 'ACTIVE' ? Boolean(p.is_on_shift) : false }),
      });
      showToast(`Partner ${next === 'SUSPENDED' ? 'suspended' : 're-activated'}`);
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Status update failed', 'error');
    }
  };

  const handleUploadPhoto = async (partnerId: string, file: File | null) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await apiFetch(`/api/admin/delivery-partners/${partnerId}/photo`, { method: 'POST', body: fd });
      showToast('Partner photo updated');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Photo upload failed', 'error');
    }
  };

  return (
    <AdminLayout title="Delivery Partner Control Panel">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[#526071]">
            Manage store riders, monitor completed/failed delivery KPIs, COD cash held, and suspend/activate accounts.
          </div>
          <div className="flex gap-2">
            <Link to="/admin/live-tracking" className="inline-flex h-8 items-center rounded border border-[#E1E5EB] bg-white px-3 text-xs font-medium hover:bg-[#F5F7FA]">
              Open Live Control Room
            </Link>
            <Link to="/admin/audit" className="inline-flex h-8 items-center rounded border border-[#E1E5EB] bg-white px-3 text-xs font-medium hover:bg-[#F5F7FA]">
              Staff RBAC Provisioning
            </Link>
          </div>
        </div>

        <Card className="p-5">
          <h2 className="mb-3 text-base font-bold text-[#202630]">Fleet Roster &amp; Performance</h2>
          <Table>
            <thead>
              <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                <th className="py-2 font-medium">Partner</th>
                <th className="py-2 font-medium">Vehicle &amp; Status</th>
                <th className="py-2 text-right font-medium">Active</th>
                <th className="py-2 text-right font-medium">Delivered / Failed</th>
                <th className="py-2 text-right font-medium">Avg Time</th>
                <th className="py-2 text-right font-medium">Pending COD</th>
                <th className="py-2 text-right font-medium">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB]">
              {partners.map((p) => (
                <tr key={p.id} className="text-xs">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2.5">
                      {p.photo_url ? (
                        <img src={p.photo_url} alt={p.full_name} className="h-9 w-9 rounded-full object-cover border border-[#E1E5EB]" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F5F7FA] border border-[#E1E5EB] text-[#526071]">
                          <Bike className="h-4 w-4" />
                        </span>
                      )}
                      <div>
                        <div className="font-semibold text-[#202630]">{p.full_name}</div>
                        <div className="text-[11px] text-[#526071]">{p.phone} · {p.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5">
                    <div>{p.vehicle_type} ({p.vehicle_number})</div>
                    <div className="text-[11px]">
                      <span className={p.account_status === 'SUSPENDED' ? 'text-[#D71920] font-semibold' : p.is_on_shift ? 'text-[#16835D] font-semibold' : 'text-[#526071]'}>
                        {p.account_status === 'SUSPENDED' ? 'SUSPENDED' : p.is_on_shift ? 'Active · On Shift' : 'Active · Off Shift'}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">{p.active_assignments}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    <span className="text-[#16835D] font-semibold">{p.completed_deliveries}</span> / <span className="text-[#D71920]">{p.failed_deliveries}</span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-[#526071]">
                    {p.avg_delivery_mins ? `${p.avg_delivery_mins} min` : '—'}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-bold">
                    {formatINRPaise(p.pending_cod_paise || 0)}
                  </td>
                  <td className="py-2.5 text-right space-x-1.5 whitespace-nowrap">
                    <label className="inline-flex h-8 items-center gap-1 rounded border border-[#E1E5EB] px-2.5 text-xs font-medium cursor-pointer hover:bg-[#F5F7FA]">
                      <Camera className="h-3 w-3" /> Photo
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUploadPhoto(p.id, e.target.files?.[0] || null)} />
                    </label>
                    <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                      <Edit3 className="h-3 w-3" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant={p.account_status === 'SUSPENDED' ? 'secondary' : 'destructive'}
                      onClick={() => handleToggleSuspend(p)}
                    >
                      {p.account_status === 'SUSPENDED' ? 'Activate' : 'Suspend'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        {editing && (
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Edit Delivery Partner · {editing.full_name}</h3>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
            <form onSubmit={handleSaveEdit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><Label>Full Name</Label><Input required value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} /></div>
              <div><Label>Phone</Label><Input required value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
              <div>
                <Label>Account Status</Label>
                <Select value={editForm.accountStatus} onChange={(e) => setEditForm({ ...editForm, accountStatus: e.target.value as 'ACTIVE' | 'SUSPENDED' })}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </Select>
              </div>
              <div><Label>Vehicle Type</Label><Input required value={editForm.vehicleType} onChange={(e) => setEditForm({ ...editForm, vehicleType: e.target.value })} /></div>
              <div><Label>Vehicle Number</Label><Input required value={editForm.vehicleNumber} onChange={(e) => setEditForm({ ...editForm, vehicleNumber: e.target.value })} /></div>
              <div className="flex items-end gap-4 pb-1.5 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={editForm.isOnShift} onChange={(e) => setEditForm({ ...editForm, isOnShift: e.target.checked })} className="accent-[#16835D]" />
                  On Shift
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={editForm.isAvailable} onChange={(e) => setEditForm({ ...editForm, isAvailable: e.target.checked })} className="accent-[#16835D]" />
                  Available
                </label>
              </div>
              <div className="sm:col-span-3">
                <Button type="submit">Save Partner Changes</Button>
              </div>
            </form>
          </Card>
        )}

        <Card className="p-5">
          <h2 className="mb-4 text-base font-bold text-[#202630]">Register New Delivery Partner</h2>
          <form onSubmit={handleCreatePartner} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><Label>Full Name*</Label><Input required value={partnerForm.fullName} onChange={(e) => setPartnerForm({ ...partnerForm, fullName: e.target.value })} /></div>
            <div><Label>Email*</Label><Input type="email" required value={partnerForm.email} onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })} /></div>
            <div><Label>Phone*</Label><Input required value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} /></div>
            <div><Label>Vehicle Type*</Label><Input required value={partnerForm.vehicleType} onChange={(e) => setPartnerForm({ ...partnerForm, vehicleType: e.target.value })} /></div>
            <div><Label>Vehicle Reg No.*</Label><Input required value={partnerForm.vehicleNumber} onChange={(e) => setPartnerForm({ ...partnerForm, vehicleNumber: e.target.value })} /></div>
            <div><Label>Temporary Password*</Label><Input type="password" required minLength={8} value={partnerForm.password} onChange={(e) => setPartnerForm({ ...partnerForm, password: e.target.value })} /></div>
            <div className="sm:col-span-3"><Button type="submit">Create Delivery Partner</Button></div>
          </form>
        </Card>
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// 2. PAYMENT, VERIFICATION, REFUNDS & COD RECONCILIATION
// ===========================================================================
interface PaymentRow {
  id: string;
  order_id: string;
  order_number: string;
  order_status: string;
  order_payment_method: string;
  cod_reconciled: number;
  cod_reconciled_at: string | null;
  customer_name: string;
  partner_name: string | null;
  method: string;
  status: string;
  amount_paise: number;
  refunded_paise: number;
  provider_reference: string | null;
  created_at: string;
}

interface CodSummaryRow {
  partner_id: string;
  partner_name: string;
  cod_orders: number;
  total_collected_paise: number;
  settled_paise: number;
  pending_reconciliation_paise: number;
}

export function AdminPaymentsPage() {
  const { showToast } = useApp();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [codSummary, setCodSummary] = useState<CodSummaryRow[]>([]);
  const [refundRequests, setRefundRequests] = useState<
    Array<{
      id: string;
      order_number: string;
      customer_name: string;
      customer_phone: string;
      reason: string;
      amount_paise: number;
      status: string;
      created_at: string;
    }>
  >([]);

  const load = () => {
    Promise.all([
      apiFetch<{ payments: PaymentRow[]; codSummary: CodSummaryRow[] }>('/api/admin/payments'),
      apiFetch<{ requests: typeof refundRequests }>('/api/admin/refund-requests'),
    ])
      .then(([p, r]) => {
        setPayments(p.payments);
        setCodSummary(p.codSummary || []);
        setRefundRequests(r.requests);
      })
      .catch(console.error);
  };

  useEffect(() => {
    load();
  }, []);

  const handleVerifyPayment = async (paymentId: string) => {
    try {
      await apiFetch(`/api/admin/payments/${paymentId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ status: 'PAID' }),
      });
      showToast('Payment marked PAID & verified');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Verification failed', 'error');
    }
  };

  const handleReconcileCod = async (orderId: string, orderNumber: string) => {
    try {
      await apiFetch(`/api/admin/orders/${orderId}/reconcile-cod`, { method: 'POST' });
      showToast(`COD settled for ${orderNumber}`);
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Reconciliation failed', 'error');
    }
  };

  const handleRefund = async (paymentId: string, amountPaise: number) => {
    try {
      await apiFetch(`/api/admin/payments/${paymentId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ amountPaise, reason: 'Admin initiated refund' }),
      });
      showToast('Refund processed');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Refund failed', 'error');
    }
  };

  const updateRefundRequest = async (id: string, status: string) => {
    await apiFetch(`/api/admin/refund-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    showToast(`Refund request marked ${status}`);
    load();
  };

  return (
    <AdminLayout title="Payments, Refunds & COD Reconciliation">
      <div className="space-y-6">
        {/* COD Reconciliation Summary by Delivery Partner */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-[#16835D]" />
              <h2 className="text-base font-bold text-[#202630]">Cash on Delivery (COD) Partner Reconciliation</h2>
            </div>
            <Link to="/admin/settings" className="text-xs font-medium text-[#D71920] hover:underline">
              Configure Delivery Fees &amp; Min Order
            </Link>
          </div>
          {codSummary.length === 0 ? (
            <p className="text-xs text-[#526071]">No delivered COD orders awaiting settlement.</p>
          ) : (
            <Table>
              <thead>
                <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                  <th className="py-2 font-medium">Delivery Partner</th>
                  <th className="py-2 text-right font-medium">Delivered COD Orders</th>
                  <th className="py-2 text-right font-medium">Total Collected</th>
                  <th className="py-2 text-right font-medium">Settled to Store</th>
                  <th className="py-2 text-right font-medium">Pending Handover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EB]">
                {codSummary.map((row) => (
                  <tr key={row.partner_id} className="text-xs">
                    <td className="py-2 font-semibold text-[#202630]">{row.partner_name}</td>
                    <td className="py-2 text-right tabular-nums">{row.cod_orders}</td>
                    <td className="py-2 text-right tabular-nums">{formatINRPaise(row.total_collected_paise)}</td>
                    <td className="py-2 text-right tabular-nums text-[#16835D] font-semibold">{formatINRPaise(row.settled_paise)}</td>
                    <td className="py-2 text-right tabular-nums font-bold text-[#D71920]">{formatINRPaise(row.pending_reconciliation_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {/* Order Payment Ledger */}
        <Card className="p-5">
          <h2 className="mb-3 text-base font-bold text-[#202630]">Order Payment &amp; COD Settlement Ledger</h2>
          <Table>
            <thead>
              <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                <th className="py-2 font-medium">Order</th>
                <th className="py-2 font-medium">Customer / Partner</th>
                <th className="py-2 font-medium">Method &amp; Ref</th>
                <th className="py-2 font-medium">Payment Status</th>
                <th className="py-2 text-right font-medium">Amount</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB]">
              {payments.map((p) => (
                <tr key={p.id} className="text-xs">
                  <td className="py-2.5">
                    <div className="font-mono font-semibold text-[#202630]">{p.order_number}</div>
                    <div className="text-[11px] text-[#526071]">{p.order_status}</div>
                  </td>
                  <td className="py-2.5">
                    <div>{p.customer_name}</div>
                    {p.partner_name && <div className="text-[11px] text-[#526071]">Rider: {p.partner_name}</div>}
                  </td>
                  <td className="py-2.5">{p.method} · {p.provider_reference || 'COD'}</td>
                  <td className="py-2.5">
                    <div className="font-semibold">{p.status}</div>
                    {p.order_payment_method === 'CASH_ON_DELIVERY' && (
                      <div className={`text-[11px] ${p.cod_reconciled ? 'text-[#16835D]' : 'text-[#9A5B00]'}`}>
                        {p.cod_reconciled ? 'COD Settled' : 'COD Unreconciled'}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-bold">{formatINRPaise(p.amount_paise)}</td>
                  <td className="py-2.5 text-right space-x-1.5 whitespace-nowrap">
                    {p.status !== 'PAID' && p.order_payment_method !== 'CASH_ON_DELIVERY' && (
                      <Button size="sm" variant="secondary" onClick={() => handleVerifyPayment(p.id)}>
                        <CheckCircle2 className="h-3 w-3" /> Verify Paid
                      </Button>
                    )}
                    {p.order_payment_method === 'CASH_ON_DELIVERY' && !p.cod_reconciled && p.order_status === 'DELIVERED' && (
                      <Button size="sm" variant="secondary" onClick={() => handleReconcileCod(p.order_id, p.order_number)}>
                        Settle COD
                      </Button>
                    )}
                    {p.status === 'PAID' && p.refunded_paise === 0 && (
                      <Button size="sm" variant="outline" onClick={() => handleRefund(p.id, p.amount_paise)}>
                        Issue Refund
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        {/* Customer Refund Requests */}
        <Card className="p-5">
          <h2 className="mb-3 text-base font-bold text-[#202630]">Customer Refund Requests ({refundRequests.length})</h2>
          {refundRequests.length === 0 ? (
            <p className="text-xs text-[#526071]">No refund requests submitted by customers.</p>
          ) : (
            <Table>
              <thead>
                <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                  <th className="py-2 font-medium">Order</th>
                  <th className="py-2 font-medium">Customer</th>
                  <th className="py-2 font-medium">Reason</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                  <th className="py-2 font-medium pl-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EB]">
                {refundRequests.map((r) => (
                  <tr key={r.id} className="text-xs">
                    <td className="py-2 font-mono font-semibold">{r.order_number}</td>
                    <td className="py-2">{r.customer_name} · {r.customer_phone}</td>
                    <td className="py-2 text-[#526071]">{r.reason}</td>
                    <td className="py-2 text-right tabular-nums font-bold">{formatINRPaise(r.amount_paise)}</td>
                    <td className="py-2 pl-3">
                      <Select
                        value={r.status}
                        onChange={(e) => updateRefundRequest(r.id, e.target.value)}
                        className="h-8 text-xs"
                      >
                        <option value="SUBMITTED">SUBMITTED</option>
                        <option value="APPROVED">APPROVED</option>
                        <option value="PROCESSED">PROCESSED</option>
                        <option value="REJECTED">REJECTED</option>
                      </Select>
                    </td>
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
// 3. ANALYTICS, 8-REPORT SUITE & CSV/XLSX EXPORTS
// ===========================================================================
type ReportTab =
  | 'sales'
  | 'inventory_valuation'
  | 'low_stock'
  | 'expiring_stock'
  | 'cancellations'
  | 'delivery_performance'
  | 'payment_reconciliation'
  | 'product_performance';

interface FullReportsResponse {
  byCategory: Array<{ category_name: string; revenue_paise: number; units_sold: number }>;
  taxSummary: {
    gross_sales_paise: number;
    total_gst_paise: number;
    total_discounts_paise: number;
    net_revenue_paise: number;
    order_count: number;
  };
  inventoryValuation: Array<{
    medicine_name: string;
    sku: string;
    batch_number: string;
    expiry_date: string;
    quantity_available: number;
    purchase_price_paise: number;
    mrp_paise: number;
    cost_value_paise: number;
    mrp_value_paise: number;
    is_quarantined: number;
  }>;
  lowAndOutStock: Array<{ medicine_name: string; sku: string; pack_size: string; sellable_stock: number }>;
  expiringAndExpired: Array<{
    medicine_name: string;
    sku: string;
    batch_number: string;
    expiry_date: string;
    quantity_available: number;
    quantity_expired: number;
    is_quarantined: number;
    days_to_expiry: number;
  }>;
  cancellations: Array<{ order_number: string; total_paise: number; cancellation_reason: string | null; updated_at: string; customer_name: string }>;
  deliveryPerformance: Array<{ partner_name: string; vehicle_number: string; delivered_count: number; failed_count: number; avg_delivery_mins: number | null }>;
  paymentReconciliation: Array<{ payment_method: string; payment_status: string; txn_count: number; total_paise: number; cod_settled_paise: number }>;
  productPerformance: Array<{ medicine_name: string; sku: string; units_sold: number; revenue_paise: number }>;
}

const REPORT_TABS: Array<{ id: ReportTab; label: string }> = [
  { id: 'sales', label: 'Sales & GST' },
  { id: 'inventory_valuation', label: 'Inventory Valuation' },
  { id: 'low_stock', label: 'Low / Out of Stock' },
  { id: 'expiring_stock', label: 'Expiring / Expired' },
  { id: 'cancellations', label: 'Cancellations' },
  { id: 'delivery_performance', label: 'Delivery Performance' },
  { id: 'payment_reconciliation', label: 'Payment Reconciliation' },
  { id: 'product_performance', label: 'Product Performance' },
];

export function AdminReportsPage() {
  const [report, setReport] = useState<FullReportsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('sales');

  useEffect(() => {
    apiFetch<FullReportsResponse>('/api/admin/reports').then(setReport).catch(console.error);
  }, []);

  return (
    <AdminLayout title="Reports, Analytics & Data Exports">
      {!report ? (
        <div className="h-48 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
      ) : (
        <div className="space-y-6">
          {/* GST & Sales Summary Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Active/Completed Orders</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{report.taxSummary.order_count}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Gross Item Sales</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{formatINRPaise(report.taxSummary.gross_sales_paise)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[#526071]">GST Component</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{formatINRPaise(report.taxSummary.total_gst_paise)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Net Order Revenue</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-[#16835D]">{formatINRPaise(report.taxSummary.net_revenue_paise)}</div>
            </Card>
          </div>

          <Card className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#D71920]" />
                <h2 className="text-base font-bold text-[#202630]">Operational &amp; Compliance Reports</h2>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/admin/reports/export?type=${activeTab}&format=csv`}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-[#E1E5EB] bg-white px-3 text-xs font-medium text-[#202630] hover:bg-[#F5F7FA]"
                >
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </a>
                <a
                  href={`/api/admin/reports/export?type=${activeTab}&format=xlsx`}
                  className="inline-flex h-8 items-center gap-1.5 rounded border border-[#16835D] bg-[#F2FBF7] px-3 text-xs font-semibold text-[#16835D] hover:bg-[#E4F7EE]"
                >
                  <Download className="h-3.5 w-3.5" /> Export Excel (.xlsx)
                </a>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 border-b border-[#E1E5EB] pb-3">
              {REPORT_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                    activeTab === t.id
                      ? 'border-[#D71920] bg-[#FFF5F5] text-[#D71920]'
                      : 'border-[#E1E5EB] bg-white text-[#526071] hover:text-[#202630]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {activeTab === 'sales' && (
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">Category</th>
                    <th className="py-2 text-right font-medium">Units Sold</th>
                    <th className="py-2 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {report.byCategory.map((c) => (
                    <tr key={c.category_name} className="text-xs">
                      <td className="py-2 font-semibold">{c.category_name}</td>
                      <td className="py-2 text-right tabular-nums">{c.units_sold}</td>
                      <td className="py-2 text-right font-bold tabular-nums">{formatINRPaise(c.revenue_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'inventory_valuation' && (
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">Medicine / Batch</th>
                    <th className="py-2 font-medium">Expiry</th>
                    <th className="py-2 text-right font-medium">Available</th>
                    <th className="py-2 text-right font-medium">Cost Valuation</th>
                    <th className="py-2 text-right font-medium">MRP Valuation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {report.inventoryValuation.map((r, i) => (
                    <tr key={i} className="text-xs">
                      <td className="py-2">
                        <span className="font-semibold">{r.medicine_name}</span> · <span className="font-mono">{r.batch_number}</span>
                      </td>
                      <td className="py-2 tabular-nums text-[#526071]">{r.expiry_date}</td>
                      <td className="py-2 text-right tabular-nums">{r.quantity_available}</td>
                      <td className="py-2 text-right tabular-nums">{formatINRPaise(r.cost_value_paise)}</td>
                      <td className="py-2 text-right font-bold tabular-nums">{formatINRPaise(r.mrp_value_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'low_stock' && (
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">Medicine</th>
                    <th className="py-2 font-medium">SKU</th>
                    <th className="py-2 font-medium">Pack</th>
                    <th className="py-2 text-right font-medium">Sellable Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {report.lowAndOutStock.map((r) => (
                    <tr key={r.sku} className="text-xs">
                      <td className="py-2 font-semibold">{r.medicine_name}</td>
                      <td className="py-2 font-mono text-[#526071]">{r.sku}</td>
                      <td className="py-2 text-[#526071]">{r.pack_size}</td>
                      <td className={`py-2 text-right font-bold tabular-nums ${r.sellable_stock === 0 ? 'text-[#D71920]' : 'text-[#9A5B00]'}`}>
                        {r.sellable_stock}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'expiring_stock' && (
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">Medicine / Batch</th>
                    <th className="py-2 font-medium">Expiry Date</th>
                    <th className="py-2 text-right font-medium">Days Left</th>
                    <th className="py-2 text-right font-medium">Available Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {report.expiringAndExpired.map((r, i) => (
                    <tr key={i} className="text-xs">
                      <td className="py-2 font-semibold">{r.medicine_name} · <span className="font-mono">{r.batch_number}</span></td>
                      <td className="py-2 tabular-nums">{r.expiry_date}</td>
                      <td className={`py-2 text-right font-bold tabular-nums ${r.days_to_expiry <= 0 ? 'text-[#D71920]' : 'text-[#9A5B00]'}`}>
                        {r.days_to_expiry <= 0 ? 'EXPIRED' : `${r.days_to_expiry}d`}
                      </td>
                      <td className="py-2 text-right tabular-nums">{r.quantity_available}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'cancellations' && (
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">Order</th>
                    <th className="py-2 font-medium">Customer</th>
                    <th className="py-2 font-medium">Cancellation Reason</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {report.cancellations.map((r) => (
                    <tr key={r.order_number} className="text-xs">
                      <td className="py-2 font-mono font-bold">{r.order_number}</td>
                      <td className="py-2">{r.customer_name}</td>
                      <td className="py-2 text-[#526071]">{r.cancellation_reason || 'Cancelled'}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">{formatINRPaise(r.total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'delivery_performance' && (
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">Delivery Partner</th>
                    <th className="py-2 font-medium">Vehicle</th>
                    <th className="py-2 text-right font-medium">Delivered</th>
                    <th className="py-2 text-right font-medium">Failed</th>
                    <th className="py-2 text-right font-medium">Avg Mins</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {report.deliveryPerformance.map((r) => (
                    <tr key={r.vehicle_number} className="text-xs">
                      <td className="py-2 font-semibold">{r.partner_name}</td>
                      <td className="py-2 text-[#526071]">{r.vehicle_number}</td>
                      <td className="py-2 text-right font-semibold text-[#16835D] tabular-nums">{r.delivered_count}</td>
                      <td className="py-2 text-right text-[#D71920] tabular-nums">{r.failed_count}</td>
                      <td className="py-2 text-right tabular-nums">{r.avg_delivery_mins ? `${r.avg_delivery_mins} min` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'payment_reconciliation' && (
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">Method</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Transactions</th>
                    <th className="py-2 text-right font-medium">Total Amount</th>
                    <th className="py-2 text-right font-medium">COD Settled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {report.paymentReconciliation.map((r, i) => (
                    <tr key={i} className="text-xs">
                      <td className="py-2 font-semibold">{r.payment_method}</td>
                      <td className="py-2">{r.payment_status}</td>
                      <td className="py-2 text-right tabular-nums">{r.txn_count}</td>
                      <td className="py-2 text-right font-bold tabular-nums">{formatINRPaise(r.total_paise)}</td>
                      <td className="py-2 text-right tabular-nums text-[#16835D]">{formatINRPaise(r.cod_settled_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            {activeTab === 'product_performance' && (
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="py-2 font-medium">Medicine</th>
                    <th className="py-2 font-medium">SKU</th>
                    <th className="py-2 text-right font-medium">Units Sold</th>
                    <th className="py-2 text-right font-medium">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {report.productPerformance.map((r) => (
                    <tr key={r.sku} className="text-xs">
                      <td className="py-2 font-semibold">{r.medicine_name}</td>
                      <td className="py-2 font-mono text-[#526071]">{r.sku}</td>
                      <td className="py-2 text-right tabular-nums">{r.units_sold}</td>
                      <td className="py-2 text-right font-bold tabular-nums">{formatINRPaise(r.revenue_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}

// ===========================================================================
// 4. EDITABLE BUSINESS & STORE SETTINGS
// ===========================================================================
export function AdminSettingsPage() {
  const { refreshStore, showToast } = useApp();
  const [form, setForm] = useState<PublicStoreInfo | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ store: PublicStoreInfo }>('/api/admin/settings')
      .then((d) => setForm(d.store))
      .catch(console.error);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ store: PublicStoreInfo }>('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name,
          addressLine1: form.addressLine1,
          landmark: form.landmark,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode,
          phone: form.phone,
          email: form.email,
          operatingHours: form.operatingHours,
          googleMapsUrl: form.googleMapsUrl,
          drugLicenseNumber: form.drugLicenseNumber,
          gstin: form.gstin,
          deliveryFeePaise: Number(form.deliveryFeePaise),
          freeDeliveryThresholdPaise: Number(form.freeDeliveryThresholdPaise),
          minimumOrderPaise: Number(form.minimumOrderPaise || 0),
          deliveryRadiusKm: Number(form.deliveryRadiusKm),
        }),
      });
      setForm(res.store);
      await refreshStore();
      showToast('Business & store settings updated');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleMediaUpload = async (kind: 'logo' | 'storefront', file: File | null) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', file);
    try {
      const res = await apiFetch<{ store: PublicStoreInfo }>('/api/admin/settings/upload', {
        method: 'POST',
        body: fd,
      });
      setForm(res.store);
      await refreshStore();
      showToast(`Store ${kind} updated`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    }
  };

  return (
    <AdminLayout title="Business & Store Settings">
      {!form ? (
        <div className="h-64 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
      ) : (
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-base font-bold text-[#202630]">
              Store Identity, Location, Operating Hours &amp; Delivery Thresholds
            </h2>
            <form onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Business / Store Name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Street Address</Label>
                <Input required value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
              </div>
              <div>
                <Label>Landmark</Label>
                <Input value={form.landmark || ''} onChange={(e) => setForm({ ...form, landmark: e.target.value })} />
              </div>
              <div>
                <Label>City</Label>
                <Input required value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <Label>State &amp; PIN Code</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input required value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                  <Input required value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Contact Phone</Label>
                <Input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <Label>Operating Hours</Label>
                <Input required value={form.operatingHours} onChange={(e) => setForm({ ...form, operatingHours: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Google Maps Reference URL</Label>
                <Input value={form.googleMapsUrl} onChange={(e) => setForm({ ...form, googleMapsUrl: e.target.value })} />
              </div>
              <div>
                <Label>Drug License Number</Label>
                <Input value={form.drugLicenseNumber || ''} onChange={(e) => setForm({ ...form, drugLicenseNumber: e.target.value })} />
              </div>
              <div>
                <Label>GSTIN</Label>
                <Input value={form.gstin || ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
              </div>
              <div>
                <Label>Default Delivery Fee (Paise · e.g. 2500 = ₹25)</Label>
                <Input type="number" min="0" value={form.deliveryFeePaise} onChange={(e) => setForm({ ...form, deliveryFeePaise: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Free Delivery Threshold (Paise · e.g. 49900 = ₹499)</Label>
                <Input type="number" min="0" value={form.freeDeliveryThresholdPaise} onChange={(e) => setForm({ ...form, freeDeliveryThresholdPaise: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Minimum Order Value (Paise · e.g. 10000 = ₹100)</Label>
                <Input type="number" min="0" value={form.minimumOrderPaise || 0} onChange={(e) => setForm({ ...form, minimumOrderPaise: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Delivery Service Radius (km)</Label>
                <Input type="number" min="1" max="50" value={form.deliveryRadiusKm} onChange={(e) => setForm({ ...form, deliveryRadiusKm: Number(e.target.value) })} />
              </div>
              <div className="sm:col-span-2 flex flex-wrap gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Business Settings'}
                </Button>
                <Link to="/admin/content" className="inline-flex h-9 items-center rounded-md border border-[#E1E5EB] px-4 text-xs font-medium text-[#202630] hover:bg-[#F5F7FA]">
                  Manage Banners, Coupons, PINs &amp; Policies
                </Link>
              </div>
            </form>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-base font-bold text-[#202630]">Replace Store Logo &amp; Storefront Photograph</h2>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Upload Real Store Logo</Label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleMediaUpload('logo', e.target.files?.[0] || null)}
                  className="text-xs"
                />
                <div className="text-xs text-[#526071]">
                  Current: {form.logoUrl ? 'Custom logo uploaded' : 'Placeholder emblem active'}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Upload Real Storefront Photograph</Label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleMediaUpload('storefront', e.target.files?.[0] || null)}
                  className="text-xs"
                />
                <div className="text-xs text-[#526071]">
                  Current: {form.storefrontPhotoUrl ? 'Custom storefront photo uploaded' : 'Placeholder container active'}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}
