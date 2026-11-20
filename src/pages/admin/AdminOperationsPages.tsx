import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  PhoneCall,
  Printer,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout.tsx';
import { LiveRouteMap } from '../../components/LiveRouteMap.tsx';
import { Button, Card, Input, Label, Select, Table, Textarea } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import {
  formatIndianDateTime,
  formatINRPaise,
  ORDER_STATUS_LABELS,
  OrderStatus,
  PrescriptionStatus,
  type PublicStoreInfo,
} from '../../shared/types.ts';

// ===========================================================================
// 1. ADMIN DASHBOARD OVERVIEW (13 REAL DB KPIs + SVG CHARTS + DATE RANGES)
// ===========================================================================
interface OverviewResponse {
  range: string;
  kpis: {
    todaysRevenuePaise: number;
    todaysOrders: number;
    pendingOrders: number;
    awaitingRxApproval: number;
    ordersBeingPrepared: number;
    activeDeliveries: number;
    completedOrders: number;
    cancelledOrders: number;
    totalCustomers: number;
    availableDeliveryPartners: number;
    lowStockMedicines: number;
    outOfStockMedicines: number;
    expiringInventoryCount: number;
    rangeRevenuePaise: number;
    rangeOrdersCount: number;
  };
  revenueSeries: Array<{ day: string; revenue_paise: number; order_count: number }>;
  paymentBreakdown: Array<{ payment_method: string; order_count: number; total_paise: number }>;
  topProducts: Array<{ medicine_id: string; medicine_name: string; units_sold: number; revenue_paise: number }>;
  lowStockBatches: Array<{
    id: string;
    batch_number: string;
    quantity_available: number;
    expiry_date: string;
    medicine_name: string;
    sku: string;
  }>;
  recentOrders: Array<{
    id: string;
    order_number: string;
    status: OrderStatus;
    prescription_status: string;
    total_paise: number;
    payment_method: string;
    customer_name: string;
    created_at: string;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    actor_name: string | null;
    created_at: string;
  }>;
}

export function AdminOverviewPage() {
  const [range, setRange] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('weekly');
  const [fromDate, setFromDate] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<OverviewResponse | null>(null);

  const load = () => {
    const params = new URLSearchParams({ range });
    if (range === 'custom') {
      params.set('from', fromDate);
      params.set('to', toDate);
    }
    apiFetch<OverviewResponse>(`/api/admin/overview?${params.toString()}`).then(setData).catch(console.error);
  };

  useEffect(() => {
    load();
  }, [range, fromDate, toDate]);

  const maxRev = useMemo(
    () => Math.max(10000, ...(data?.revenueSeries.map((d) => d.revenue_paise) || [0])),
    [data]
  );
  const maxOrd = useMemo(
    () => Math.max(1, ...(data?.revenueSeries.map((d) => d.order_count) || [0])),
    [data]
  );
  const totalPayAmount = useMemo(
    () => Math.max(1, data?.paymentBreakdown.reduce((s, p) => s + p.total_paise, 0) || 1),
    [data]
  );

  return (
    <AdminLayout title="Pharmacy Command Dashboard">
      <div className="space-y-6">
        {/* Date Range Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E1E5EB] bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['daily', 'weekly', 'monthly', 'custom'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize cursor-pointer ${
                  range === r
                    ? 'bg-[#D71920] text-white'
                    : 'bg-[#F5F7FA] text-[#526071] hover:text-[#202630]'
                }`}
              >
                {r}
              </button>
            ))}
            {range === 'custom' && (
              <div className="flex items-center gap-2 ml-2">
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 text-xs w-36" />
                <span className="text-xs text-[#526071]">to</span>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 text-xs w-36" />
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Metrics
          </Button>
        </div>

        {!data ? (
          <div className="h-56 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
        ) : (
          <>
            {/* Primary 13 Real DB Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Card className="p-4">
                <div className="text-xs font-medium text-[#526071]">Today's Revenue</div>
                <div className="mt-1 text-xl font-bold text-[#202630] tabular-nums">
                  {formatINRPaise(data.kpis.todaysRevenuePaise)}
                </div>
                <div className="mt-1 text-[11px] text-[#526071] tabular-nums">
                  Range: {formatINRPaise(data.kpis.rangeRevenuePaise)}
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-[#526071]">Today's Orders</div>
                <div className="mt-1 text-xl font-bold text-[#202630] tabular-nums">{data.kpis.todaysOrders}</div>
                <div className="mt-1 text-[11px] text-[#526071] tabular-nums">
                  Range: {data.kpis.rangeOrdersCount} orders
                </div>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-[#526071]">Awaiting Rx Approval</div>
                <div className="mt-1 text-xl font-bold text-[#D71920] tabular-nums">
                  {data.kpis.awaitingRxApproval}
                </div>
                <Link to="/admin/prescriptions" className="mt-1 inline-block text-[11px] font-medium text-[#D71920] hover:underline">
                  Pharmacist Queue →
                </Link>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-[#526071]">Active Deliveries</div>
                <div className="mt-1 text-xl font-bold text-[#16835D] tabular-nums">
                  {data.kpis.activeDeliveries}
                </div>
                <Link to="/admin/live-tracking" className="mt-1 inline-block text-[11px] font-medium text-[#16835D] hover:underline">
                  Live Control Room →
                </Link>
              </Card>
              <Card className="p-4">
                <div className="text-xs font-medium text-[#526071]">Expiring Inventory (≤90d)</div>
                <div className="mt-1 text-xl font-bold text-[#B5121B] tabular-nums">
                  {data.kpis.expiringInventoryCount}
                </div>
                <Link to="/admin/inventory" className="mt-1 inline-block text-[11px] font-medium text-[#526071] hover:underline">
                  Review Batches →
                </Link>
              </Card>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Card className="p-3.5">
                <div className="text-[11px] text-[#526071]">Pending Orders</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{data.kpis.pendingOrders}</div>
              </Card>
              <Card className="p-3.5">
                <div className="text-[11px] text-[#526071]">Being Prepared</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{data.kpis.ordersBeingPrepared}</div>
              </Card>
              <Card className="p-3.5">
                <div className="text-[11px] text-[#526071]">Completed</div>
                <div className="mt-1 text-lg font-bold text-[#16835D] tabular-nums">{data.kpis.completedOrders}</div>
              </Card>
              <Card className="p-3.5">
                <div className="text-[11px] text-[#526071]">Cancelled</div>
                <div className="mt-1 text-lg font-bold text-[#526071] tabular-nums">{data.kpis.cancelledOrders}</div>
              </Card>
              <Card className="p-3.5">
                <div className="text-[11px] text-[#526071]">Total Customers</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{data.kpis.totalCustomers}</div>
              </Card>
              <Card className="p-3.5">
                <div className="text-[11px] text-[#526071]">Available Riders</div>
                <div className="mt-1 text-lg font-bold text-[#16835D] tabular-nums">{data.kpis.availableDeliveryPartners}</div>
              </Card>
              <Card className="p-3.5">
                <div className="text-[11px] text-[#526071]">Low-Stock SKUs</div>
                <div className="mt-1 text-lg font-bold text-[#D97706] tabular-nums">{data.kpis.lowStockMedicines}</div>
              </Card>
              <Card className="p-3.5">
                <div className="text-[11px] text-[#526071]">Out-of-Stock SKUs</div>
                <div className="mt-1 text-lg font-bold text-[#D71920] tabular-nums">{data.kpis.outOfStockMedicines}</div>
              </Card>
            </div>

            {/* Revenue & Order Volume Charts + Payment Breakdown */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <Card className="lg:col-span-5 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#202630]">Revenue Trend (INR)</h2>
                  <span className="text-xs text-[#526071] tabular-nums">
                    Total {formatINRPaise(data.kpis.rangeRevenuePaise)}
                  </span>
                </div>
                {data.revenueSeries.length === 0 ? (
                  <p className="py-12 text-center text-xs text-[#526071]">No revenue recorded in selected range.</p>
                ) : (
                  <svg viewBox="0 0 400 170" className="w-full h-44" role="img" aria-label="Revenue trend bar chart">
                    <line x1="30" y1="140" x2="390" y2="140" stroke="#E1E5EB" strokeWidth="1" />
                    <line x1="30" y1="80" x2="390" y2="80" stroke="#F1F5F9" strokeWidth="1" strokeDasharray="3 3" />
                    <line x1="30" y1="20" x2="390" y2="20" stroke="#F1F5F9" strokeWidth="1" strokeDasharray="3 3" />
                    {data.revenueSeries.map((pt, i) => {
                      const slotW = 350 / Math.max(1, data.revenueSeries.length);
                      const barW = Math.min(34, Math.max(10, slotW * 0.6));
                      const barH = Math.max(4, Math.round((pt.revenue_paise / maxRev) * 115));
                      const x = 35 + i * slotW + (slotW - barW) / 2;
                      const y = 140 - barH;
                      return (
                        <g key={pt.day}>
                          <rect x={x} y={y} width={barW} height={barH} rx="3" fill="#D71920">
                            <title>{`${pt.day}: ${formatINRPaise(pt.revenue_paise)} (${pt.order_count} orders)`}</title>
                          </rect>
                          <text x={x + barW / 2} y="156" textAnchor="middle" fontSize="9" fill="#526071">
                            {pt.day.slice(5)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </Card>

              <Card className="lg:col-span-4 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#202630]">Order Volume</h2>
                  <span className="text-xs text-[#526071] tabular-nums">{data.kpis.rangeOrdersCount} orders</span>
                </div>
                {data.revenueSeries.length === 0 ? (
                  <p className="py-12 text-center text-xs text-[#526071]">No orders in selected range.</p>
                ) : (
                  <svg viewBox="0 0 340 170" className="w-full h-44" role="img" aria-label="Order volume bar chart">
                    <line x1="20" y1="140" x2="330" y2="140" stroke="#E1E5EB" strokeWidth="1" />
                    {data.revenueSeries.map((pt, i) => {
                      const slotW = 300 / Math.max(1, data.revenueSeries.length);
                      const barW = Math.min(30, Math.max(10, slotW * 0.6));
                      const barH = Math.max(4, Math.round((pt.order_count / maxOrd) * 110));
                      const x = 25 + i * slotW + (slotW - barW) / 2;
                      const y = 140 - barH;
                      return (
                        <g key={pt.day}>
                          <rect x={x} y={y} width={barW} height={barH} rx="3" fill="#16835D" />
                          <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="9" fontWeight="600" fill="#202630">
                            {pt.order_count}
                          </text>
                          <text x={x + barW / 2} y="156" textAnchor="middle" fontSize="9" fill="#526071">
                            {pt.day.slice(5)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </Card>

              <Card className="lg:col-span-3 p-5">
                <h2 className="mb-3 text-sm font-bold text-[#202630]">Payment Breakdown</h2>
                <div className="space-y-3">
                  {data.paymentBreakdown.length === 0 ? (
                    <p className="text-xs text-[#526071]">No payment records in selected period.</p>
                  ) : (
                    data.paymentBreakdown.map((p) => {
                      const pct = Math.round((p.total_paise / totalPayAmount) * 100);
                      return (
                        <div key={p.payment_method} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-[#202630]">{p.payment_method.replace(/_/g, ' ')}</span>
                            <span className="tabular-nums text-[#526071]">
                              {formatINRPaise(p.total_paise)} ({p.order_count})
                            </span>
                          </div>
                          <div className="h-2 w-full rounded bg-[#F5F7FA] overflow-hidden">
                            <div className="h-full bg-[#16835D]" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </Card>
            </div>

            {/* Bottom Operational Tables */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <Card className="lg:col-span-6 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold">Recent Orders</h2>
                  <Link to="/admin/orders" className="text-xs font-medium text-[#D71920] hover:underline">
                    Manage All →
                  </Link>
                </div>
                <Table>
                  <thead>
                    <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                      <th className="py-2 font-medium">Order</th>
                      <th className="py-2 font-medium">Customer</th>
                      <th className="py-2 font-medium">Status</th>
                      <th className="py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E1E5EB]">
                    {data.recentOrders.map((o) => (
                      <tr key={o.id} className="text-xs">
                        <td className="py-2 font-mono font-semibold">
                          <Link to={`/admin/orders/${o.id}`} className="text-[#D71920] hover:underline">
                            {o.order_number}
                          </Link>
                        </td>
                        <td className="py-2">{o.customer_name}</td>
                        <td className="py-2 font-medium text-[#16835D]">{ORDER_STATUS_LABELS[o.status] || o.status}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{formatINRPaise(o.total_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>

              <Card className="lg:col-span-6 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold">Top-Selling Products</h2>
                  <Link to="/admin/reports" className="text-xs font-medium text-[#D71920] hover:underline">
                    Full Reports →
                  </Link>
                </div>
                <Table>
                  <thead>
                    <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                      <th className="py-2 font-medium">Product</th>
                      <th className="py-2 text-right font-medium">Units</th>
                      <th className="py-2 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E1E5EB]">
                    {data.topProducts.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-xs text-[#526071]">No sales in range.</td>
                      </tr>
                    ) : (
                      data.topProducts.map((tp) => (
                        <tr key={tp.medicine_id} className="text-xs">
                          <td className="py-2 font-medium">{tp.medicine_name}</td>
                          <td className="py-2 text-right tabular-nums">{tp.units_sold}</td>
                          <td className="py-2 text-right font-semibold tabular-nums">{formatINRPaise(tp.revenue_paise)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </Card>

              <Card className="lg:col-span-6 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold">Low Stock Batches (≤ 20 Units)</h2>
                  <Link to="/admin/inventory" className="text-xs font-medium text-[#D71920] hover:underline">
                    Manage Stock →
                  </Link>
                </div>
                {data.lowStockBatches.length === 0 ? (
                  <p className="text-xs text-[#526071]">All batches currently above threshold.</p>
                ) : (
                  <Table>
                    <thead>
                      <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                        <th className="py-2 font-medium">Medicine</th>
                        <th className="py-2 font-medium">Batch</th>
                        <th className="py-2 font-medium">Expiry</th>
                        <th className="py-2 text-right font-medium">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E1E5EB]">
                      {data.lowStockBatches.map((b) => (
                        <tr key={b.id} className="text-xs">
                          <td className="py-2 font-medium">{b.medicine_name}</td>
                          <td className="py-2 font-mono">{b.batch_number}</td>
                          <td className="py-2 tabular-nums">{b.expiry_date}</td>
                          <td className="py-2 text-right font-bold text-[#D71920] tabular-nums">{b.quantity_available}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>

              <Card className="lg:col-span-6 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold">Recent Audit Activity</h2>
                  <Link to="/admin/audit" className="text-xs font-medium text-[#D71920] hover:underline">
                    Audit Logs →
                  </Link>
                </div>
                <div className="divide-y divide-[#E1E5EB]">
                  {data.recentActivity.map((act) => (
                    <div key={act.id} className="flex items-center justify-between py-2 text-xs">
                      <div>
                        <span className="font-semibold text-[#202630]">{act.action}</span>
                        <span className="text-[#526071]"> · {act.entity_type} · {act.actor_name || 'System'}</span>
                      </div>
                      <span className="text-[#526071] tabular-nums">{formatIndianDateTime(act.created_at)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// 2. ORDER MANAGEMENT (11 WORKFLOW TABS + DETAIL DRAWER + REASON ENFORCEMENT)
// ===========================================================================
interface AdminOrder {
  id: string;
  order_number: string;
  status: OrderStatus;
  prescription_status: string;
  fulfillment_type: string;
  subtotal_paise: number;
  discount_paise: number;
  delivery_fee_paise: number;
  tax_paise: number;
  total_paise: number;
  payment_method: string;
  payment_status: string;
  customer_name: string;
  customer_phone: string;
  address_line1: string | null;
  postal_code: string | null;
  delivery_partner_id: string | null;
  partner_name: string | null;
  prescription_id: string | null;
  quoted_amount_paise: number | null;
  rx_quotation_accepted: number | null;
  refund_request_status: string | null;
  cancellation_reason: string | null;
  internal_notes: string | null;
  created_at: string;
  items: Array<{
    id: string;
    medicine_name: string;
    pack_size: string;
    quantity: number;
    line_total_paise: number;
    batch_number?: string | null;
    expiry_date?: string | null;
  }>;
}

interface OrderDetailPayload {
  order: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
  payment: Record<string, unknown> | null;
  refundRequests: Array<Record<string, unknown>>;
  prescription: Record<string, unknown> | null;
  store: PublicStoreInfo;
}

const ORDER_TABS = [
  { key: 'ALL', label: 'All Orders' },
  { key: 'NEW', label: 'New Orders' },
  { key: 'RX_REVIEW', label: 'Rx Review' },
  { key: 'AWAITING_CUSTOMER', label: 'Awaiting Approval' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'PREPARING', label: 'Preparing' },
  { key: 'PACKED', label: 'Packed' },
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'OUT_FOR_DELIVERY', label: 'Out for Delivery' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'REFUND_REQUESTS', label: 'Refund Requests' },
] as const;

export function AdminOrdersPage() {
  const { orderId: routeOrderId } = useParams<{ orderId?: string }>();
  const { showToast } = useApp();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [partners, setPartners] = useState<Array<{ id: string; full_name: string; vehicle_number: string; account_status: string }>>([]);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<OrderDetailPayload | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [notesDraft, setNotesDraft] = useState('');

  const load = () => {
    apiFetch<{ orders: AdminOrder[] }>('/api/admin/orders').then((d) => setOrders(d.orders)).catch(console.error);
    apiFetch<{ deliveryPartners: Array<{ id: string; full_name: string; vehicle_number: string; account_status: string }> }>(
      '/api/admin/delivery-partners'
    )
      .then((d) => setPartners(d.deliveryPartners.filter((p) => p.account_status !== 'SUSPENDED')))
      .catch(console.error);
  };

  const openOrderDetail = (id: string) => {
    apiFetch<OrderDetailPayload>(`/api/admin/orders/${id}`)
      .then((d) => {
        setSelectedDetail(d);
        setNotesDraft(String(d.order.internal_notes || ''));
        setStatusReason('');
      })
      .catch((e) => showToast(e instanceof Error ? e.message : 'Unable to load order detail', 'error'));
  };

  useEffect(() => {
    load();
    const socket = io({ withCredentials: true });
    socket.on('order:updated', () => load());
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (routeOrderId) openOrderDetail(routeOrderId);
  }, [routeOrderId]);

  const matchesTab = (o: AdminOrder, tab: string): boolean => {
    switch (tab) {
      case 'NEW':
        return o.status === OrderStatus.ORDER_RECEIVED || o.status === OrderStatus.PAYMENT_PENDING;
      case 'RX_REVIEW':
        return (
          (o.status === OrderStatus.PRESCRIPTION_PENDING ||
            o.status === OrderStatus.PHARMACIST_REVIEW ||
            o.status === OrderStatus.CLARIFICATION_REQUIRED) &&
          !o.quoted_amount_paise
        );
      case 'AWAITING_CUSTOMER':
        return (
          o.status === OrderStatus.AWAITING_CUSTOMER_ACCEPTANCE ||
          (Boolean(o.quoted_amount_paise) &&
            !o.rx_quotation_accepted &&
            o.status !== OrderStatus.CANCELLED &&
            o.status !== OrderStatus.REJECTED)
        );
      case 'CONFIRMED':
        return o.status === OrderStatus.CONFIRMED || o.status === OrderStatus.APPROVED;
      case 'PREPARING':
        return o.status === OrderStatus.PREPARING || o.status === OrderStatus.PACKED;
      case 'PACKED':
        return (
          (o.status === OrderStatus.PACKED || o.status === OrderStatus.READY_FOR_DISPATCH || o.status === OrderStatus.READY_FOR_PICKUP) &&
          !o.delivery_partner_id
        );
      case 'ASSIGNED':
        return (
          (o.status === OrderStatus.DRIVER_ASSIGNED || (o.status === OrderStatus.READY_FOR_DISPATCH && Boolean(o.delivery_partner_id)))
        );
      case 'OUT_FOR_DELIVERY':
        return o.status === OrderStatus.OUT_FOR_DELIVERY;
      case 'DELIVERED':
        return o.status === OrderStatus.DELIVERED || o.status === OrderStatus.COLLECTED;
      case 'CANCELLED':
        return (
          o.status === OrderStatus.CANCELLED ||
          o.status === OrderStatus.REJECTED ||
          o.status === OrderStatus.RETURNED
        );
      case 'REFUND_REQUESTS':
        return Boolean(o.refund_request_status);
      default:
        return true;
    }
  };

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (!matchesTab(o, activeTab)) return false;
      if (!q) return true;
      return (
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_phone.toLowerCase().includes(q)
      );
    });
  }, [orders, activeTab, search]);

  const updateStatus = async (orderId: string, status: OrderStatus, reason?: string) => {
    try {
      await apiFetch(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, reason, note: reason }),
      });
      showToast('Order status updated');
      load();
      if (selectedDetail && selectedDetail.order.id === orderId) openOrderDetail(orderId);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to update status', 'error');
    }
  };

  const assignPartner = async (orderId: string, deliveryPartnerId: string) => {
    if (!deliveryPartnerId) return;
    try {
      await apiFetch(`/api/admin/orders/${orderId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ deliveryPartnerId }),
      });
      showToast('Delivery partner assigned');
      load();
      if (selectedDetail && selectedDetail.order.id === orderId) openOrderDetail(orderId);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to assign partner', 'error');
    }
  };

  const saveNotes = async (orderId: string) => {
    try {
      await apiFetch(`/api/admin/orders/${orderId}/notes`, {
        method: 'PATCH',
        body: JSON.stringify({ internalNotes: notesDraft }),
      });
      showToast('Internal staff notes saved');
      if (selectedDetail) openOrderDetail(orderId);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save notes', 'error');
    }
  };

  return (
    <AdminLayout title="Order Fulfillment & Dispatch">
      <div className="space-y-4">
        {/* 11 Status Filter Tabs */}
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-[#E1E5EB] bg-white p-2">
          {ORDER_TABS.map((t) => {
            const count = orders.filter((o) => matchesTab(o, t.key)).length;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                  active ? 'bg-[#D71920] text-white' : 'bg-[#F5F7FA] text-[#526071] hover:text-[#202630]'
                }`}
              >
                {t.label} <span className="tabular-nums opacity-80">({count})</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#526071]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order #, customer name, or phone"
              className="pl-9"
            />
          </div>
          <span className="text-xs text-[#526071] tabular-nums">{filteredOrders.length} orders shown</span>
        </div>

        <Card className="p-0 overflow-hidden">
          <Table>
            <thead className="bg-[#F5F7FA] border-b border-[#E1E5EB] text-xs text-[#526071]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Order</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Items & Rx</th>
                <th className="px-4 py-2.5 font-medium">Payment</th>
                <th className="px-4 py-2.5 font-medium">Fulfillment Status</th>
                <th className="px-4 py-2.5 font-medium">Assign Rider</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E5EB] text-xs">
              {filteredOrders.map((o) => (
                <tr key={o.id} className="hover:bg-[#F9FAFB]">
                  <td className="px-4 py-3 align-top">
                    <button
                      type="button"
                      onClick={() => openOrderDetail(o.id)}
                      className="font-mono font-bold text-[#D71920] hover:underline cursor-pointer"
                    >
                      {o.order_number}
                    </button>
                    <div className="text-[11px] text-[#526071] tabular-nums">{formatIndianDateTime(o.created_at)}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-[#202630]">{o.customer_name}</div>
                    <div className="text-[#526071]">{o.customer_phone}</div>
                    <div className="text-[11px] text-[#526071] truncate max-w-[180px]">
                      {o.fulfillment_type === 'STORE_PICKUP' ? 'Store Pickup' : o.address_line1 || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="tabular-nums">{o.items.length} item(s)</div>
                    <div className="text-[11px] text-[#526071]">Rx: {o.prescription_status}</div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-bold tabular-nums">{formatINRPaise(o.total_paise)}</div>
                    <div className="text-[11px] text-[#526071]">
                      {o.payment_method.replace(/_/g, ' ')} · {o.payment_status}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="font-semibold text-[#16835D]">{ORDER_STATUS_LABELS[o.status] || o.status}</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <Select
                      value={o.delivery_partner_id || ''}
                      onChange={(e) => assignPartner(o.id, e.target.value)}
                      className="h-8 text-xs min-w-[155px]"
                      disabled={o.fulfillment_type === 'STORE_PICKUP'}
                    >
                      <option value="">{o.fulfillment_type === 'STORE_PICKUP' ? 'Store Pickup' : 'Assign Partner...'}</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <Button variant="outline" size="sm" onClick={() => openOrderDetail(o.id)}>
                      Inspect
                    </Button>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-[#526071]">
                    No orders match the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </Card>
      </div>

      {/* Order Detail Drawer Modal */}
      {selectedDetail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="w-full max-w-2xl bg-white h-full overflow-y-auto border-l border-[#E1E5EB] p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-[#E1E5EB] pb-4">
              <div>
                <div className="text-xs text-[#526071]">Order Detail & Clinical Audit</div>
                <h2 className="text-lg font-bold font-mono text-[#202630]">
                  {String(selectedDetail.order.order_number)}
                </h2>
                <div className="text-xs text-[#526071] mt-0.5">
                  Placed {formatIndianDateTime(String(selectedDetail.order.created_at))} ·{' '}
                  {String(selectedDetail.order.fulfillment_type || 'DELIVERY')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5" />
                  Print GST Invoice
                </Button>
                <button
                  type="button"
                  onClick={() => setSelectedDetail(null)}
                  className="rounded p-1.5 text-[#526071] hover:bg-[#F5F7FA]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="rounded-md border border-[#E1E5EB] p-3.5 space-y-1">
                <div className="font-semibold text-[#526071] uppercase text-[11px]">Customer & Delivery Address</div>
                <div className="font-bold text-sm text-[#202630]">{String(selectedDetail.order.customer_name)}</div>
                <div>{String(selectedDetail.order.customer_phone)} · {String(selectedDetail.order.customer_email || '')}</div>
                <div className="text-[#526071]">
                  {selectedDetail.order.address_line1
                    ? `${String(selectedDetail.order.address_line1)}, ${String(selectedDetail.order.address_city || '')} ${String(selectedDetail.order.postal_code || '')}`
                    : 'Store Counter Pickup'}
                </div>
                {Boolean(selectedDetail.order.delivery_notes) && (
                  <div className="text-[#D71920] font-medium">
                    Instructions: {String(selectedDetail.order.delivery_notes)}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-[#E1E5EB] p-3.5 space-y-1">
                <div className="font-semibold text-[#526071] uppercase text-[11px]">Payment & Pharmacist Status</div>
                <div className="flex justify-between">
                  <span>Payment:</span>
                  <span className="font-semibold">
                    {String(selectedDetail.order.payment_method)} · {String(selectedDetail.order.payment_status)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Prescription Status:</span>
                  <span className="font-semibold">{String(selectedDetail.order.prescription_status)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Invoice #:</span>
                  <span className="font-mono">{String(selectedDetail.order.invoice_number || 'Pending')}</span>
                </div>
                <div className="flex justify-between">
                  <span>Assigned Partner:</span>
                  <span className="font-semibold">{String(selectedDetail.order.partner_name || 'Unassigned')}</span>
                </div>
              </div>
            </div>

            {/* Order Items + Batch Allocation */}
            <div className="rounded-md border border-[#E1E5EB] overflow-hidden">
              <div className="bg-[#F5F7FA] px-3.5 py-2 text-xs font-bold">Items & Batch Allocation</div>
              <Table>
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                    <th className="px-3.5 py-2 font-medium">Medicine</th>
                    <th className="px-3.5 py-2 font-medium">Batch / Expiry</th>
                    <th className="px-3.5 py-2 text-right font-medium">Qty</th>
                    <th className="px-3.5 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB] text-xs">
                  {selectedDetail.items.map((it) => (
                    <tr key={String(it.id)}>
                      <td className="px-3.5 py-2">
                        <div className="font-semibold">{String(it.medicine_name)}</div>
                        <div className="text-[11px] text-[#526071]">{String(it.pack_size)}</div>
                      </td>
                      <td className="px-3.5 py-2 font-mono text-[11px]">
                        {String(it.batch_number || 'FEFO')} · Exp {String(it.expiry_date || '—')}
                      </td>
                      <td className="px-3.5 py-2 text-right tabular-nums">{Number(it.quantity)}</td>
                      <td className="px-3.5 py-2 text-right font-semibold tabular-nums">
                        {formatINRPaise(Number(it.line_total_paise))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="border-t border-[#E1E5EB] px-3.5 py-2.5 flex justify-between text-xs font-bold">
                <span>Grand Total (incl. GST {formatINRPaise(Number(selectedDetail.order.tax_paise))})</span>
                <span className="tabular-nums text-sm">{formatINRPaise(Number(selectedDetail.order.total_paise))}</span>
              </div>
            </div>

            {/* Pharmacist Review Summary if Rx linked */}
            {selectedDetail.prescription && (
              <div className="rounded-md border border-[#E1E5EB] p-3.5 text-xs space-y-1">
                <div className="font-bold text-[#202630]">Linked Prescription Verification</div>
                <div>
                  Patient: <span className="font-semibold">{String(selectedDetail.prescription.patient_name)}</span> · Status:{' '}
                  <span className="font-semibold">{String(selectedDetail.prescription.status)}</span>
                </div>
                {Boolean(selectedDetail.prescription.reviewed_by_name) && (
                  <div>
                    Reviewed by Pharmacist: <span className="font-semibold">{String(selectedDetail.prescription.reviewed_by_name)}</span> —{' '}
                    {String(selectedDetail.prescription.pharmacist_remarks || '')}
                  </div>
                )}
              </div>
            )}

            {/* Status Update + Mandatory Reason */}
            <div className="rounded-md border border-[#E1E5EB] p-4 space-y-3">
              <div className="text-xs font-bold">Status Transition & Cancellation Control</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Reason / Audit Note (Mandatory for Cancel or Override)</Label>
                  <Input
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    placeholder="e.g., Customer requested cancel before packing"
                  />
                </div>
                <div>
                  <Label>Update Status</Label>
                  <Select
                    value={String(selectedDetail.order.status)}
                    onChange={(e) => updateStatus(String(selectedDetail.order.id), e.target.value as OrderStatus, statusReason)}
                  >
                    {Object.values(OrderStatus).map((st) => (
                      <option key={st} value={st}>
                        {ORDER_STATUS_LABELS[st]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>

            {/* Internal Staff Notes */}
            <div className="space-y-2">
              <Label>Internal Pharmacy Notes (Not visible to customer)</Label>
              <div className="flex gap-2">
                <Textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Packing instructions, batch callout, or follow-up details..."
                  className="min-h-[60px]"
                />
                <Button variant="outline" onClick={() => saveNotes(String(selectedDetail.order.id))}>
                  Save Notes
                </Button>
              </div>
            </div>

            {/* Chronological History */}
            <div className="space-y-2">
              <div className="text-xs font-bold">Order Timeline</div>
              <div className="divide-y divide-[#E1E5EB] rounded-md border border-[#E1E5EB]">
                {selectedDetail.history.map((h) => (
                  <div key={String(h.id)} className="px-3 py-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold">{String(h.status)}</span>
                      <span className="text-[#526071]"> — {String(h.note || '')} ({String(h.changed_by_name || 'System')})</span>
                    </div>
                    <span className="text-[#526071] tabular-nums">{formatIndianDateTime(String(h.created_at))}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

// ===========================================================================
// 3. RESTRICTED PHARMACIST PRESCRIPTION VERIFICATION WORKSPACE
// ===========================================================================
interface RxRecord {
  id: string;
  order_id: string | null;
  order_number: string | null;
  order_status: string | null;
  customer_name: string;
  customer_phone: string;
  patient_name: string;
  doctor_name: string | null;
  notes: string | null;
  file_url: string;
  signed_file_url?: string;
  file_mime_type: string;
  status: string;
  latest_remarks: string | null;
  reviewed_by_pharmacist: string | null;
  reviewed_at: string | null;
  quoted_amount_paise: number | null;
  pharmacist_quotation_notes: string | null;
  quotation_accepted: number;
  created_at: string;
  itemReviews: Array<{
    id: string;
    medicine_name: string;
    requested_qty: number;
    approved_qty: number;
    status: string;
    pharmacist_note: string | null;
  }>;
  reviewHistory: Array<{
    id: string;
    pharmacist_name: string;
    pharmacist_reg_number: string | null;
    decision: string;
    remarks: string;
    created_at: string;
  }>;
}

export function AdminPrescriptionsPage() {
  const { showToast } = useApp();
  const [prescriptions, setPrescriptions] = useState<RxRecord[]>([]);
  const [canReviewRx, setCanReviewRx] = useState(false);
  const [selectedRx, setSelectedRx] = useState<RxRecord | null>(null);

  // Pharmacist checklist & review form state
  const [checklist, setChecklist] = useState({
    patientVerified: false,
    doctorLegible: false,
    dateValid: false,
    dosageChecked: false,
  });
  const [remarks, setRemarks] = useState('');
  const [quoteRupees, setQuoteRupees] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [itemRows, setItemRows] = useState<
    Array<{ medicineName: string; requestedQty: number; approvedQty: number; status: 'APPROVED' | 'REJECTED' | 'CLARIFICATION_NEEDED'; pharmacistNote: string }>
  >([]);

  const load = () => {
    apiFetch<{ canReviewRx: boolean; prescriptions: RxRecord[] }>('/api/admin/prescriptions')
      .then((d) => {
        setCanReviewRx(d.canReviewRx);
        setPrescriptions(d.prescriptions);
        if (d.prescriptions.length > 0 && !selectedRx) {
          selectRx(d.prescriptions[0]);
        } else if (selectedRx) {
          const updated = d.prescriptions.find((p) => p.id === selectedRx.id);
          if (updated) setSelectedRx(updated);
        }
      })
      .catch(console.error);
  };

  const selectRx = (rx: RxRecord) => {
    setSelectedRx(rx);
    setRemarks(rx.latest_remarks || '');
    setQuoteRupees(rx.quoted_amount_paise ? String(Math.round(rx.quoted_amount_paise / 100)) : '');
    setQuoteNotes(rx.pharmacist_quotation_notes || '');
    setChecklist({ patientVerified: false, doctorLegible: false, dateValid: false, dosageChecked: false });
    setItemRows(
      rx.itemReviews.length > 0
        ? rx.itemReviews.map((ir) => ({
            medicineName: ir.medicine_name,
            requestedQty: ir.requested_qty,
            approvedQty: ir.approved_qty,
            status: (ir.status as 'APPROVED' | 'REJECTED' | 'CLARIFICATION_NEEDED') || 'APPROVED',
            pharmacistNote: ir.pharmacist_note || '',
          }))
        : [{ medicineName: '', requestedQty: 1, approvedQty: 1, status: 'APPROVED', pharmacistNote: '' }]
    );
  };

  useEffect(() => {
    load();
    const socket = io({ withCredentials: true });
    socket.on('prescription:updated', () => load());
    return () => {
      socket.disconnect();
    };
  }, []);

  const allChecklistChecked =
    checklist.patientVerified && checklist.doctorLegible && checklist.dateValid && checklist.dosageChecked;

  const submitReview = async (decision: PrescriptionStatus) => {
    if (!selectedRx) return;
    if (!canReviewRx) {
      showToast('Only Registered Pharmacists or Super Admin can review prescriptions.', 'error');
      return;
    }
    if (!remarks.trim()) {
      showToast('Enter pharmacist verification remarks before submitting', 'error');
      return;
    }
    if (decision === PrescriptionStatus.APPROVED && !allChecklistChecked) {
      showToast('Confirm all 4 clinical verification checklist items before approving', 'error');
      return;
    }

    const validItems = itemRows.filter((r) => r.medicineName.trim().length >= 2);

    try {
      await apiFetch(`/api/admin/prescriptions/${selectedRx.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          remarks,
          quotedAmountPaise: quoteRupees ? Math.round(Number(quoteRupees) * 100) : null,
          pharmacistQuotationNotes: quoteNotes || null,
          items: validItems.length > 0 ? validItems : undefined,
        }),
      });
      showToast(`Prescription marked ${decision}`);
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to review prescription', 'error');
    }
  };

  return (
    <AdminLayout title="Pharmacist Prescription Verification">
      <div className="space-y-4">
        {!canReviewRx && (
          <div className="flex items-start gap-3 rounded-lg border border-[#D71920] bg-[#FFF5F5] p-4 text-xs text-[#202630]">
            <ShieldAlert className="h-5 w-5 text-[#D71920] shrink-0" />
            <div>
              <div className="font-bold text-[#D71920]">Read-Only Compliance View — Registered Pharmacist Required</div>
              <p className="mt-0.5 text-[#526071]">
                Under Indian Pharmacy Regulations, ordinary administrators and inventory staff cannot approve or bypass prescription verification. Sign in as a Registered Pharmacist (or Super Admin) to sign off clinical reviews.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Queue */}
          <Card className="lg:col-span-4 p-0 overflow-hidden">
            <div className="border-b border-[#E1E5EB] bg-[#F5F7FA] px-4 py-3 text-xs font-bold">
              Submitted Prescriptions ({prescriptions.length})
            </div>
            <div className="divide-y divide-[#E1E5EB] max-h-[680px] overflow-y-auto">
              {prescriptions.map((rx) => {
                const active = selectedRx?.id === rx.id;
                return (
                  <button
                    key={rx.id}
                    type="button"
                    onClick={() => selectRx(rx)}
                    className={`w-full text-left px-4 py-3 text-xs transition-colors cursor-pointer ${
                      active ? 'bg-[#FFF5F5]' : 'hover:bg-[#F9FAFB]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#202630]">{rx.patient_name}</span>
                      <span
                        className={`font-semibold ${
                          rx.status === 'APPROVED'
                            ? 'text-[#16835D]'
                            : rx.status === 'REJECTED'
                              ? 'text-[#D71920]'
                              : 'text-[#D97706]'
                        }`}
                      >
                        {rx.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[#526071]">
                      {rx.customer_name} · {rx.order_number || 'Direct Upload'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#526071] tabular-nums">
                      {formatIndianDateTime(rx.created_at)}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* Right Clinical Workspace */}
          <div className="lg:col-span-8 space-y-4">
            {!selectedRx ? (
              <Card className="p-8 text-center text-sm text-[#526071]">Select a prescription to review.</Card>
            ) : (
              <>
                <Card className="p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E1E5EB] pb-3">
                    <div>
                      <div className="text-base font-bold text-[#202630]">
                        Patient: {selectedRx.patient_name}
                        {selectedRx.order_number ? ` · Order ${selectedRx.order_number}` : ''}
                      </div>
                      <div className="text-xs text-[#526071]">
                        Customer: {selectedRx.customer_name} ({selectedRx.customer_phone})
                        {selectedRx.doctor_name ? ` · Doctor: ${selectedRx.doctor_name}` : ''}
                      </div>
                    </div>
                    <a
                      href={selectedRx.signed_file_url || selectedRx.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-[#D71920] hover:underline"
                    >
                      Open Full Prescription File →
                    </a>
                  </div>

                  {/* Prescription Viewer */}
                  <div className="rounded-md border border-[#E1E5EB] bg-[#F5F7FA] p-3">
                    {selectedRx.file_mime_type === 'application/pdf' ? (
                      <div className="flex items-center gap-2 text-xs text-[#202630]">
                        <FileText className="h-4 w-4 text-[#D71920]" />
                        <span>PDF Prescription attached. Use "Open Full Prescription File" above to inspect all pages.</span>
                      </div>
                    ) : (
                      <img
                        src={selectedRx.signed_file_url || selectedRx.file_url}
                        alt={`Prescription for ${selectedRx.patient_name}`}
                        className="max-h-72 mx-auto rounded border border-[#E1E5EB] bg-white object-contain"
                      />
                    )}
                  </div>

                  {/* Required Verification Checklist */}
                  <div className="rounded-md border border-[#E1E5EB] p-3.5 space-y-2">
                    <div className="text-xs font-bold text-[#202630]">Mandatory Clinical Verification Checklist</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checklist.patientVerified}
                          disabled={!canReviewRx}
                          onChange={(e) => setChecklist({ ...checklist, patientVerified: e.target.checked })}
                        />
                        <span>Patient name & age match order details</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checklist.doctorLegible}
                          disabled={!canReviewRx}
                          onChange={(e) => setChecklist({ ...checklist, doctorLegible: e.target.checked })}
                        />
                        <span>Registered medical practitioner signature/reg legible</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checklist.dateValid}
                          disabled={!canReviewRx}
                          onChange={(e) => setChecklist({ ...checklist, dateValid: e.target.checked })}
                        />
                        <span>Prescription issue date within valid dispensing window</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checklist.dosageChecked}
                          disabled={!canReviewRx}
                          onChange={(e) => setChecklist({ ...checklist, dosageChecked: e.target.checked })}
                        />
                        <span>Medicine strength, form & Schedule H/H1 compliance checked</span>
                      </label>
                    </div>
                  </div>

                  {/* Itemized Medicine Verification */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold">Itemized Medicines Review</div>
                      {canReviewRx && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setItemRows([
                              ...itemRows,
                              { medicineName: '', requestedQty: 1, approvedQty: 1, status: 'APPROVED', pharmacistNote: '' },
                            ])
                          }
                        >
                          + Add Medicine Row
                        </Button>
                      )}
                    </div>
                    {itemRows.map((row, idx) => (
                      <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <Input
                          className="sm:col-span-4 h-9 text-xs"
                          placeholder="Medicine name & strength"
                          disabled={!canReviewRx}
                          value={row.medicineName}
                          onChange={(e) => {
                            const next = [...itemRows];
                            next[idx].medicineName = e.target.value;
                            setItemRows(next);
                          }}
                        />
                        <Input
                          type="number"
                          className="sm:col-span-2 h-9 text-xs"
                          placeholder="Req Qty"
                          disabled={!canReviewRx}
                          value={row.requestedQty}
                          onChange={(e) => {
                            const next = [...itemRows];
                            next[idx].requestedQty = Number(e.target.value);
                            setItemRows(next);
                          }}
                        />
                        <Input
                          type="number"
                          className="sm:col-span-2 h-9 text-xs"
                          placeholder="Appr Qty"
                          disabled={!canReviewRx}
                          value={row.approvedQty}
                          onChange={(e) => {
                            const next = [...itemRows];
                            next[idx].approvedQty = Number(e.target.value);
                            setItemRows(next);
                          }}
                        />
                        <Select
                          className="sm:col-span-2 h-9 text-xs"
                          disabled={!canReviewRx}
                          value={row.status}
                          onChange={(e) => {
                            const next = [...itemRows];
                            next[idx].status = e.target.value as 'APPROVED' | 'REJECTED' | 'CLARIFICATION_NEEDED';
                            setItemRows(next);
                          }}
                        >
                          <option value="APPROVED">Approve</option>
                          <option value="REJECTED">Reject</option>
                          <option value="CLARIFICATION_NEEDED">Clarify</option>
                        </Select>
                        <Input
                          className="sm:col-span-2 h-9 text-xs"
                          placeholder="Note"
                          disabled={!canReviewRx}
                          value={row.pharmacistNote}
                          onChange={(e) => {
                            const next = [...itemRows];
                            next[idx].pharmacistNote = e.target.value;
                            setItemRows(next);
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Quotation + Remarks */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Prepared Quotation Amount (INR ₹)</Label>
                      <Input
                        type="number"
                        disabled={!canReviewRx}
                        value={quoteRupees}
                        onChange={(e) => setQuoteRupees(e.target.value)}
                        placeholder="e.g., 420"
                      />
                    </div>
                    <div>
                      <Label>Customer Quotation Breakdown / Notes</Label>
                      <Input
                        disabled={!canReviewRx}
                        value={quoteNotes}
                        onChange={(e) => setQuoteNotes(e.target.value)}
                        placeholder="Itemized pack count & brand confirmation"
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Pharmacist Verification Remarks (Mandatory)</Label>
                    <Textarea
                      disabled={!canReviewRx}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Document dosage verification, Schedule H check, or clarification details..."
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={!canReviewRx}
                      onClick={() => submitReview(PrescriptionStatus.APPROVED)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve Prescription & Send Quotation
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!canReviewRx}
                      onClick={() => submitReview(PrescriptionStatus.CLARIFICATION_NEEDED)}
                    >
                      Request Clarification
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={!canReviewRx}
                      onClick={() => submitReview(PrescriptionStatus.REJECTED)}
                    >
                      Reject Prescription
                    </Button>
                  </div>
                </Card>

                {/* Immutable Pharmacist Audit History */}
                <Card className="p-5">
                  <h3 className="mb-3 text-sm font-bold">Immutable Pharmacist Review Audit Trail</h3>
                  {selectedRx.reviewHistory.length === 0 ? (
                    <p className="text-xs text-[#526071]">Awaiting initial registered pharmacist review.</p>
                  ) : (
                    <div className="divide-y divide-[#E1E5EB]">
                      {selectedRx.reviewHistory.map((rh) => (
                        <div key={rh.id} className="py-2.5 flex items-start justify-between gap-4 text-xs">
                          <div>
                            <div className="font-semibold text-[#202630]">
                              {rh.decision} · {rh.pharmacist_name}
                              {rh.pharmacist_reg_number ? ` (Reg: ${rh.pharmacist_reg_number})` : ''}
                            </div>
                            <div className="text-[#526071]">{rh.remarks}</div>
                          </div>
                          <span className="text-[#526071] tabular-nums shrink-0">{formatIndianDateTime(rh.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

// ===========================================================================
// 4. LIVE DELIVERY CONTROL ROOM (FLEET + DISPATCH REASSIGN + EXCEPTIONS)
// ===========================================================================
interface LiveDeliveryRow {
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
  elapsedMins: number;
  isDelayed: boolean;
}

interface LivePartner {
  id: string;
  full_name: string;
  phone: string;
  vehicle_type: string;
  vehicle_number: string;
  is_on_shift: number;
  is_available: number;
  current_lat: number | null;
  current_lng: number | null;
  location_accuracy_m: number | null;
  last_location_at: string | null;
  connectivity: 'LIVE' | 'STALE' | 'OFFLINE' | 'UNAVAILABLE';
  lastLocationAgeMins: number | null;
  lastLocationAgeSecs: number | null;
  isSuspicious: boolean;
  suspiciousReason: string | null;
  workloadCount: number;
  hasDelayedDelivery: boolean;
  primaryOrderNumber: string | null;
  primaryOrderId: string | null;
  distanceKm: number | null;
  etaMinutes: number | null;
  activeDeliveries: LiveDeliveryRow[];
}

export function AdminLiveTrackingPage() {
  const [store, setStore] = useState<PublicStoreInfo | null>(null);
  const [partners, setPartners] = useState<LivePartner[]>([]);
  const [allPartners, setAllPartners] = useState<LivePartner[]>([]);
  const [activeDeliveries, setActiveDeliveries] = useState<LiveDeliveryRow[]>([]);
  const [exceptionDeliveries, setExceptionDeliveries] = useState<LiveDeliveryRow[]>([]);
  const [mapsConfigured, setMapsConfigured] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reassignDraft, setReassignDraft] = useState<Record<string, { partnerId: string; priority: 'NORMAL' | 'URGENT' }>>({});
  const [exceptionNote, setExceptionNote] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = () => {
    apiFetch<{
      store: PublicStoreInfo;
      partners: LivePartner[];
      allPartners: LivePartner[];
      activeDeliveries: LiveDeliveryRow[];
      exceptionDeliveries: LiveDeliveryRow[];
      mapsConfigured: boolean;
    }>('/api/admin/live-tracking')
      .then((d) => {
        setStore(d.store);
        setPartners(d.partners);
        setAllPartners(d.allPartners || d.partners);
        setActiveDeliveries(d.activeDeliveries || []);
        setExceptionDeliveries(d.exceptionDeliveries || []);
        setMapsConfigured(Boolean(d.mapsConfigured));
        setSelectedId((prev) => prev || (d.partners.length > 0 ? d.partners[0].id : null));
      })
      .catch(console.error);
  };

  useEffect(() => {
    load();
    const socket = io({ withCredentials: true });
    const refreshEvents = [
      'delivery.location.updated',
      'delivery.location.stale',
      'delivery.assigned',
      'delivery.accepted',
      'delivery.completed',
      'order.created',
      'order.status.updated',
      'driver:location',
      'order:updated',
    ];
    refreshEvents.forEach((ev) => socket.on(ev, load));
    const timer = window.setInterval(load, 20000);
    return () => {
      window.clearInterval(timer);
      refreshEvents.forEach((ev) => socket.off(ev, load));
      socket.disconnect();
    };
  }, []);

  const selectedPartner = partners.find((p) => p.id === selectedId) || partners[0] || null;
  const primaryDelivery = selectedPartner?.activeDeliveries[0] || null;

  const extraDrivers = useMemo(
    () =>
      partners
        .filter((p) => p.id !== selectedPartner?.id && p.current_lat !== null && p.current_lng !== null && p.connectivity !== 'UNAVAILABLE')
        .map((p) => ({
          id: p.id,
          label: `${p.full_name} (${p.workloadCount} active)`,
          lat: Number(p.current_lat),
          lng: Number(p.current_lng),
          connectivity: p.connectivity,
          isSuspicious: p.isSuspicious,
        })),
    [partners, selectedPartner?.id]
  );

  const handleReassign = async (orderId: string, currentPartnerId: string, currentPriority: string) => {
    const draft = reassignDraft[orderId] || {
      partnerId: currentPartnerId,
      priority: currentPriority === 'URGENT' ? 'URGENT' : 'NORMAL',
    };
    if (!draft.partnerId) {
      setFeedback({ type: 'err', text: 'Select a target delivery partner to assign.' });
      return;
    }
    setActionBusy(`assign-${orderId}`);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/orders/${orderId}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          deliveryPartnerId: draft.partnerId,
          priority: draft.priority,
        }),
      });
      setFeedback({ type: 'ok', text: 'Dispatch assignment updated and broadcasted to rider.' });
      load();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Unable to reassign order.' });
    } finally {
      setActionBusy(null);
    }
  };

  const handleResolveException = async (
    orderId: string,
    action: 'MARK_RETURNED' | 'REOPEN_FOR_DISPATCH' | 'CANCEL_ORDER'
  ) => {
    const note = (exceptionNote[orderId] || '').trim() || `Control room resolved via ${action}`;
    setActionBusy(`exc-${orderId}`);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/assignments/${orderId}/resolve-exception`, {
        method: 'POST',
        body: JSON.stringify({ action, note }),
      });
      setFeedback({ type: 'ok', text: `Exception resolved (${action}).` });
      load();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Unable to resolve exception.' });
    } finally {
      setActionBusy(null);
    }
  };

  const handleRegenerateOtp = async (orderId: string) => {
    setActionBusy(`otp-${orderId}`);
    setFeedback(null);
    try {
      await apiFetch(`/api/admin/orders/${orderId}/regenerate-otp`, { method: 'POST' });
      setFeedback({ type: 'ok', text: 'Fresh delivery OTP generated for customer order.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Failed to regenerate OTP.' });
    } finally {
      setActionBusy(null);
    }
  };

  const suspiciousCount = partners.filter((p) => p.isSuspicious).length;
  const delayedCount = activeDeliveries.filter((d) => d.isDelayed).length;

  return (
    <AdminLayout title="Live Delivery Control Room">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E1E5EB] bg-white px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-3 text-[#526071]">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-[#16835D]" />
              <span>Active-shift &amp; active-order telemetry only</span>
            </div>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums font-semibold text-[#202630]">{partners.length} active partners</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums font-semibold text-[#202630]">{activeDeliveries.length} active dispatches</span>
            {delayedCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-[#D97706] tabular-nums">{delayedCount} delayed</span>
              </>
            )}
            {suspiciousCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-[#D71920] tabular-nums">{suspiciousCount} GPS anomaly</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>Maps Route API: {mapsConfigured ? 'Configured' : 'Fallback View'}</span>
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Telemetry
          </Button>
        </div>

        {feedback && (
          <div
            className={`rounded-lg border px-4 py-2.5 text-xs ${
              feedback.type === 'ok'
                ? 'border-[#16835D]/30 bg-[#ECFDF5] text-[#065F46]'
                : 'border-[#D71920]/30 bg-[#FEF2F2] text-[#991B1B]'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {store && (
          <LiveRouteMap
            storeLat={store.latitude}
            storeLng={store.longitude}
            storeName={store.name}
            driverLat={selectedPartner?.current_lat}
            driverLng={selectedPartner?.current_lng}
            driverLabel={selectedPartner?.full_name || 'Delivery Partner'}
            destLat={primaryDelivery?.dest_lat}
            destLng={primaryDelivery?.dest_lng}
            destLabel={primaryDelivery ? `${primaryDelivery.customer_name} (${primaryDelivery.order_number})` : 'Store Standby'}
            distanceKm={selectedPartner?.distanceKm ?? null}
            etaMinutes={selectedPartner?.etaMinutes ?? null}
            etaUnavailableReason={!mapsConfigured && primaryDelivery ? 'ETA unavailable (route provider key not configured)' : null}
            lastLocationAt={selectedPartner?.last_location_at}
            isLocationStale={selectedPartner?.connectivity === 'STALE' || selectedPartner?.connectivity === 'OFFLINE'}
            googleMapsUrl={store.googleMapsUrl}
            extraDrivers={extraDrivers}
          />
        )}

        {exceptionDeliveries.length > 0 && (
          <Card className="p-5 space-y-4 border-[#D71920]/30 bg-[#FFFBFB]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-[#D71920]">
                <ShieldAlert className="h-4 w-4" />
                <span>Exception Queue Requiring Dispatch Action ({exceptionDeliveries.length})</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {exceptionDeliveries.map((ex) => (
                <div key={ex.assignment_id} className="rounded-lg border border-[#E1E5EB] bg-white p-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <Link to={`/admin/orders/${ex.order_id}`} className="font-mono text-sm font-bold text-[#D71920] hover:underline">
                        {ex.order_number}
                      </Link>
                      <span className="mx-1.5 text-[#526071]">·</span>
                      <span className="font-semibold text-[#202630]">{ex.delivery_status}</span>
                    </div>
                    <span className="tabular-nums font-semibold text-[#202630]">{formatINRPaise(ex.total_paise)}</span>
                  </div>
                  <div className="text-[#526071]">
                    Driver: <span className="font-medium text-[#202630]">{ex.partner_name}</span> ({ex.partner_phone}) · Customer: {ex.customer_name}
                  </div>
                  {(ex.rejection_reason || ex.failure_reason) && (
                    <div className="rounded bg-[#F5F7FA] px-3 py-2 text-[#202630]">
                      Reason: {ex.rejection_reason || ex.failure_reason}
                    </div>
                  )}
                  <Input
                    value={exceptionNote[ex.order_id] ?? ''}
                    onChange={(e) => setExceptionNote((prev) => ({ ...prev, [ex.order_id]: e.target.value }))}
                    placeholder="Dispatch resolution note (required for audit log)"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionBusy === `exc-${ex.order_id}`}
                      onClick={() => handleResolveException(ex.order_id, 'REOPEN_FOR_DISPATCH')}
                    >
                      Reopen Dispatch
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actionBusy === `exc-${ex.order_id}`}
                      onClick={() => handleResolveException(ex.order_id, 'MARK_RETURNED')}
                    >
                      Mark Returned to Store
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={actionBusy === `exc-${ex.order_id}`}
                      onClick={() => handleResolveException(ex.order_id, 'CANCEL_ORDER')}
                    >
                      Cancel Order
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-7 p-0 overflow-hidden">
            <div className="border-b border-[#E1E5EB] bg-[#F5F7FA] px-4 py-3 text-xs font-bold">
              Active Shift &amp; Assigned Partners ({partners.length})
            </div>
            <Table>
              <thead>
                <tr className="border-b border-[#E1E5EB] text-xs text-[#526071]">
                  <th className="px-4 py-2.5 font-medium">Partner &amp; Vehicle</th>
                  <th className="px-4 py-2.5 font-medium">Workload &amp; Primary</th>
                  <th className="px-4 py-2.5 font-medium">Connectivity</th>
                  <th className="px-4 py-2.5 text-right font-medium">Accuracy / Ping</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EB] text-xs">
                {partners.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`cursor-pointer ${selectedPartner?.id === p.id ? 'bg-[#FFF5F5]' : 'hover:bg-[#F9FAFB]'}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#202630]">{p.full_name}</div>
                      <div className="text-[#526071]">
                        {p.vehicle_type} · {p.vehicle_number}
                      </div>
                      {p.isSuspicious && (
                        <div className="mt-0.5 font-semibold text-[#D71920]">
                          GPS Anomaly: {p.suspiciousReason || 'Flagged telemetry'}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#202630] tabular-nums">
                        {p.workloadCount} active {p.workloadCount === 1 ? 'order' : 'orders'}
                      </div>
                      {p.primaryOrderNumber ? (
                        <div className="text-[#526071]">
                          <span className="font-mono font-bold text-[#D71920]">{p.primaryOrderNumber}</span>
                          {p.etaMinutes !== null ? (
                            <span className="ml-1.5 text-[#16835D] tabular-nums">· ETA {p.etaMinutes}m</span>
                          ) : (
                            <span className="ml-1.5">· {p.distanceKm !== null ? `${p.distanceKm} km` : 'Route pending'}</span>
                          )}
                          {p.hasDelayedDelivery && <span className="ml-1.5 font-semibold text-[#D97706]">· Delayed</span>}
                        </div>
                      ) : (
                        <div className="text-[#526071]">Standby at Store</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      <span
                        className={
                          p.connectivity === 'LIVE'
                            ? 'text-[#16835D]'
                            : p.connectivity === 'STALE'
                              ? 'text-[#D97706]'
                              : 'text-[#D71920]'
                        }
                      >
                        {p.connectivity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#526071]">
                      <div>{p.location_accuracy_m ? `±${Math.round(p.location_accuracy_m)}m` : '±GPS'}</div>
                      <div className="text-[11px]">
                        {p.lastLocationAgeSecs !== null
                          ? p.lastLocationAgeSecs < 120
                            ? `${p.lastLocationAgeSecs}s ago`
                            : `${p.lastLocationAgeMins}m ago`
                          : 'Never'}
                      </div>
                    </td>
                  </tr>
                ))}
                {partners.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-xs text-[#526071]">
                      No delivery partners currently on shift.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card>

          <Card className="lg:col-span-5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Partner Inspection &amp; Reassignment</h2>
              {selectedPartner?.phone && (
                <a
                  href={`tel:${selectedPartner.phone}`}
                  className="inline-flex items-center gap-1.5 rounded border border-[#E1E5EB] px-2.5 py-1 text-xs font-semibold text-[#202630] hover:bg-[#F5F7FA]"
                >
                  <PhoneCall className="h-3.5 w-3.5 text-[#16835D]" />
                  Call Partner
                </a>
              )}
            </div>

            {!selectedPartner ? (
              <p className="text-xs text-[#526071]">Select a partner row to inspect route coordinates and active deliveries.</p>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#526071]">Partner:</span>
                  <span className="font-semibold">
                    {selectedPartner.full_name} ({selectedPartner.phone})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#526071]">Shift / Availability:</span>
                  <span className="font-semibold">
                    {selectedPartner.is_on_shift ? 'On Shift' : 'Off Shift'} ·{' '}
                    {selectedPartner.is_available ? 'Accepting Dispatch' : 'Busy / Paused'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#526071]">GPS Coordinates:</span>
                  <span className="font-mono tabular-nums">
                    {selectedPartner.current_lat?.toFixed(5) || '—'}, {selectedPartner.current_lng?.toFixed(5) || '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#526071]">Last GPS Update:</span>
                  <span className="tabular-nums">{formatIndianDateTime(selectedPartner.last_location_at)}</span>
                </div>
                {selectedPartner.isSuspicious && (
                  <div className="rounded border border-[#D71920]/30 bg-[#FEF2F2] p-2.5 text-[#991B1B]">
                    GPS Anomaly Detected: {selectedPartner.suspiciousReason || 'Unrealistic speed or jump reported'}
                  </div>
                )}

                <div className="border-t border-[#E1E5EB] pt-3 space-y-2.5">
                  <div className="font-bold">Assigned Active Deliveries ({selectedPartner.activeDeliveries.length})</div>
                  {selectedPartner.activeDeliveries.length === 0 ? (
                    <p className="text-[#526071]">No active dispatches assigned.</p>
                  ) : (
                    selectedPartner.activeDeliveries.map((ad) => {
                      const draft = reassignDraft[ad.order_id] || {
                        partnerId: ad.delivery_partner_id,
                        priority: ad.priority === 'URGENT' ? 'URGENT' : 'NORMAL',
                      };
                      return (
                        <div key={ad.order_id} className="rounded border border-[#E1E5EB] p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <Link to={`/admin/orders/${ad.order_id}`} className="font-mono font-bold text-[#D71920] hover:underline">
                                {ad.order_number}
                              </Link>
                              <span className="mx-1.5 text-[#526071]">·</span>
                              <span className="font-semibold text-[#16835D]">{ad.delivery_status}</span>
                              {ad.priority === 'URGENT' && <span className="ml-1.5 font-bold text-[#D71920]">· URGENT</span>}
                            </div>
                            <span className="tabular-nums text-[#526071]">{ad.elapsedMins}m elapsed</span>
                          </div>
                          <div className="text-[#202630]">
                            {ad.customer_name} · {ad.line1 || 'Mira Road East'}
                          </div>
                          {ad.isDelayed && (
                            <div className="font-semibold text-[#D97706]">Delayed beyond dispatch target</div>
                          )}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Select
                              value={draft.partnerId}
                              onChange={(e) =>
                                setReassignDraft((prev) => ({
                                  ...prev,
                                  [ad.order_id]: { ...draft, partnerId: e.target.value },
                                }))
                              }
                              className="h-8 flex-1 min-w-[140px]"
                            >
                              {allPartners.map((ap) => (
                                <option key={ap.id} value={ap.id}>
                                  {ap.full_name} ({ap.is_on_shift ? 'On Shift' : 'Off'} · {ap.workloadCount})
                                </option>
                              ))}
                            </Select>
                            <Select
                              value={draft.priority}
                              onChange={(e) =>
                                setReassignDraft((prev) => ({
                                  ...prev,
                                  [ad.order_id]: { ...draft, priority: e.target.value as 'NORMAL' | 'URGENT' },
                                }))
                              }
                              className="h-8 w-24"
                            >
                              <option value="NORMAL">Normal</option>
                              <option value="URGENT">Urgent</option>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionBusy === `assign-${ad.order_id}`}
                              onClick={() => handleReassign(ad.order_id, ad.delivery_partner_id, ad.priority)}
                            >
                              Reassign
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={actionBusy === `otp-${ad.order_id}`}
                              onClick={() => handleRegenerateOtp(ad.order_id)}
                            >
                              New OTP
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
