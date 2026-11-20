import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  MapPin,
  Navigation,
  Phone,
  CheckCircle2,
  LocateFixed,
  AlertTriangle,
  Wifi,
  WifiOff,
  Bell,
  Camera,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  XCircle,
  IndianRupee,
  Clock,
} from 'lucide-react';
import { DeliveryLayout } from '../../components/DeliveryLayout.tsx';
import { LiveRouteMap } from '../../components/LiveRouteMap.tsx';
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.ts';
import { apiFetch } from '../../lib/api.ts';
import {
  cacheEssentialAssignment,
  clearCachedEssentialAssignment,
  deliveryTracker,
  enqueueOfflineStatusUpdate,
  flushOfflineQueue,
  getCachedEssentialAssignment,
  getOfflineQueue,
  type OfflineQueuedStatusEvent,
  type TrackingTelemetrySnapshot,
} from '../../services/location-tracker.ts';
import {
  DELIVERY_STATUS_LABELS,
  DeliveryAssignmentStatus,
  formatIndianDateTime,
  formatINRPaise,
  TRACKABLE_ASSIGNMENT_STATUSES,
  type PublicStoreInfo,
} from '../../shared/types.ts';

interface AssignmentSummary {
  id: string;
  order_id: string;
  order_number: string;
  status: string;
  priority?: string;
  assigned_at?: string;
  estimated_distance_km?: number | null;
  pickup_time_target?: string | null;
  failure_reason?: string | null;
  total_paise: number;
  payment_method: string;
  payment_status: string;
  delivery_notes?: string | null;
  customer_name: string;
  customer_phone: string;
  line1: string;
  landmark: string | null;
  city: string;
  postal_code: string;
  dest_lat?: number | null;
  dest_lng?: number | null;
}

interface PartnerSummary {
  id: string;
  full_name: string;
  phone: string;
  vehicle_type: string;
  vehicle_number: string;
  is_available: number;
  is_on_shift: number;
  current_lat: number | null;
  current_lng: number | null;
  location_accuracy_m: number | null;
  last_location_at: string | null;
}

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: number;
  created_at: string;
}

export function DeliveryDashboardPage() {
  const { showToast } = useApp();
  const isOnline = useOnlineStatus();
  const [data, setData] = useState<{
    partner: PartnerSummary;
    stats: {
      activeCount: number;
      pendingCount: number;
      completedTodayCount: number;
      completedCount: number;
      pendingCashCollectionPaise: number;
      pendingCashOrdersCount: number;
      unreadNotifications: number;
      gpsRetentionDays: number;
    };
    activeAssignments: AssignmentSummary[];
    store: PublicStoreInfo;
  } | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [queuedEvents, setQueuedEvents] = useState<OfflineQueuedStatusEvent[]>(() => getOfflineQueue());
  const [togglingDuty, setTogglingDuty] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<AssignmentSummary | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = () => {
    apiFetch<typeof data>('/api/delivery/dashboard')
      .then((res) => {
        setData(res);
        const primary = res?.activeAssignments.find((a) => a.status !== 'ASSIGNED') || res?.activeAssignments[0];
        if (primary) {
          cacheEssentialAssignment({
            orderId: primary.order_id,
            orderNumber: primary.order_number,
            status: primary.status,
            customerName: primary.customer_name,
            customerPhone: primary.customer_phone,
            addressSummary: `${primary.line1 || ''}, ${primary.city || ''} ${primary.postal_code || ''}`,
            paymentMethod: primary.payment_method,
            paymentStatus: primary.payment_status,
            totalPaise: primary.total_paise,
            deliveryNotes: primary.delivery_notes || null,
            cachedAt: new Date().toISOString(),
          });
        } else {
          clearCachedEssentialAssignment();
        }
      })
      .catch(console.error);

    apiFetch<{ notifications: NotificationRow[] }>('/api/delivery/notifications')
      .then((r) => setNotifications(r.notifications))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const socket = io({ withCredentials: true, reconnection: true });
    socket.on('delivery.assigned', () => {
      showToast('New delivery assignment received');
      load();
    });
    socket.on('order.status.updated', () => load());
    socket.on('order:updated', () => load());
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (isOnline && queuedEvents.length > 0) {
      flushOfflineQueue().then(({ syncedCount, remaining }) => {
        setQueuedEvents(remaining);
        if (syncedCount > 0) {
          showToast(`Synced ${syncedCount} offline delivery update(s)`);
          load();
        }
      });
    }
  }, [isOnline]);

  const toggleOnlineDuty = async () => {
    if (!data) return;
    setTogglingDuty(true);
    try {
      const nextDuty = !Boolean(data.partner.is_on_shift);
      await apiFetch('/api/delivery/profile', {
        method: 'PATCH',
        body: JSON.stringify({ isOnShift: nextDuty, isAvailable: nextDuty }),
      });
      showToast(nextDuty ? 'You are now On Duty for dispatch assignments' : 'You are now Off Duty');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to update duty status', 'error');
    } finally {
      setTogglingDuty(false);
    }
  };

  const handleAccept = async (orderId: string) => {
    try {
      await apiFetch(`/api/delivery/orders/${orderId}/accept`, { method: 'POST', body: JSON.stringify({}) });
      showToast('Assignment accepted — proceed to pharmacy pickup');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Accept failed', 'error');
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    try {
      await apiFetch(`/api/delivery/orders/${rejectTarget.order_id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason }),
      });
      showToast('Assignment rejected and returned to store dispatch');
      setRejectTarget(null);
      setRejectReason('');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Rejection failed', 'error');
    }
  };

  const cachedOffline = !data && !isOnline ? getCachedEssentialAssignment() : null;
  const pendingList = data?.activeAssignments.filter((a) => a.status === DeliveryAssignmentStatus.ASSIGNED) || [];
  const currentList = data?.activeAssignments.filter((a) => a.status !== DeliveryAssignmentStatus.ASSIGNED) || [];

  return (
    <DeliveryLayout title="Delivery Dashboard">
      {!data ? (
        cachedOffline ? (
          <Card className="p-5 space-y-3 border-[#F59E0B] bg-[#FFFBEB]">
            <div className="flex items-center gap-2 text-sm font-bold text-[#92400E]">
              <WifiOff className="h-4 w-4" />
              Offline Cached Assignment ({cachedOffline.orderNumber})
            </div>
            <div className="text-xs text-[#202630] space-y-1">
              <div>Customer: {cachedOffline.customerName} · {cachedOffline.customerPhone}</div>
              <div>Drop: {cachedOffline.addressSummary}</div>
              <div>Payment: {cachedOffline.paymentMethod} ({formatINRPaise(cachedOffline.totalPaise)})</div>
            </div>
            <Link to={`/delivery/order/${cachedOffline.orderId}`}>
              <Button size="sm" variant="secondary" className="min-h-[44px]">Open Cached Order</Button>
            </Link>
          </Card>
        ) : (
          <div className="h-48 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
        )
      ) : (
        <div className="space-y-5">
          {/* Duty Toggle & Connectivity Diagnostics */}
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-[#202630]">{data.partner.full_name}</div>
                <div className="text-xs text-[#526071]">
                  {data.partner.vehicle_type} · {data.partner.vehicle_number}
                </div>
              </div>
              <Button
                type="button"
                variant={data.partner.is_on_shift ? 'secondary' : 'outline'}
                disabled={togglingDuty}
                onClick={toggleOnlineDuty}
                className="min-h-[44px] px-4"
              >
                {data.partner.is_on_shift ? 'On Duty (Available)' : 'Off Duty (Tap to Go Online)'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#E1E5EB] pt-2.5 text-xs text-[#526071]">
              <span className="inline-flex items-center gap-1">
                {isOnline ? <Wifi className="h-3.5 w-3.5 text-[#16835D]" /> : <WifiOff className="h-3.5 w-3.5 text-[#D97706]" />}
                Network: <strong className="text-[#202630]">{isOnline ? 'Online' : 'Offline'}</strong>
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <LocateFixed className="h-3.5 w-3.5 text-[#16835D]" />
                Last GPS: {formatIndianDateTime(data.partner.last_location_at)}
                {data.partner.location_accuracy_m ? ` (±${Math.round(data.partner.location_accuracy_m)}m)` : ''}
              </span>
            </div>
            <p className="text-[11px] text-[#526071]">
              Online duty status marks you available for assignments and does not start continuous GPS tracking until you have an accepted delivery.
            </p>
          </Card>

          {queuedEvents.length > 0 && (
            <Card className="p-4 border-[#F59E0B] bg-[#FFFBEB] flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[#92400E]">
                <strong>{queuedEvents.length} status update(s)</strong> pending offline synchronization.
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!isOnline}
                onClick={() =>
                  flushOfflineQueue().then(({ syncedCount, remaining }) => {
                    setQueuedEvents(remaining);
                    if (syncedCount > 0) {
                      showToast(`Synced ${syncedCount} queued event(s)`);
                      load();
                    }
                  })
                }
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Sync Queue
              </Button>
            </Card>
          )}

          {/* Key Rider Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Pending Accept</div>
              <div className="mt-1 text-2xl font-bold text-[#D97706] tabular-nums">{data.stats.pendingCount}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Active Delivery</div>
              <div className="mt-1 text-2xl font-bold text-[#D71920] tabular-nums">{currentList.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Completed Today</div>
              <div className="mt-1 text-2xl font-bold text-[#16835D] tabular-nums">{data.stats.completedTodayCount}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Pending COD Cash</div>
              <div className="mt-1 text-xl font-bold text-[#202630] tabular-nums">
                {formatINRPaise(data.stats.pendingCashCollectionPaise)}
              </div>
            </Card>
          </div>

          {/* Pending Assignment Acceptance Queue */}
          {pendingList.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-[#202630]">New Assignments Awaiting Your Confirmation</h2>
              {pendingList.map((a) => (
                <Card key={a.id} className="p-4 space-y-3 border-[#16835D]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-[#202630]">{a.order_number}</span>
                        {a.priority === 'URGENT' && (
                          <span className="text-xs font-bold text-[#D71920]">URGENT</span>
                        )}
                      </div>
                      <div className="text-xs text-[#526071]">
                        Pickup: {data.store.name}, {data.store.addressLine1}
                      </div>
                      <div className="text-xs text-[#202630] mt-0.5">
                        Drop: {a.customer_name} · {a.line1}, {a.city}
                      </div>
                      <div className="text-[11px] text-[#526071] mt-1">
                        {a.estimated_distance_km ? `${a.estimated_distance_km} km · ` : ''}
                        {a.payment_method === 'CASH_ON_DELIVERY'
                          ? `Collect Cash ${formatINRPaise(a.total_paise)}`
                          : `Prepaid (${formatINRPaise(a.total_paise)})`}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      className="min-h-[44px]"
                      onClick={() => handleAccept(a.order_id)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Accept
                    </Button>
                    <Button
                      variant="outline"
                      className="min-h-[44px] text-[#B5121B]"
                      onClick={() => setRejectTarget(a)}
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Active In-Progress Deliveries */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#202630]">Active Execution Queue</h2>
              <Link to="/delivery/assignments" className="text-xs font-medium text-[#16835D] hover:underline">
                View All →
              </Link>
            </div>
            {currentList.length === 0 ? (
              <Card className="p-6 text-sm text-[#526071]">
                No accepted deliveries currently in progress.
              </Card>
            ) : (
              currentList.map((a) => (
                <Card key={a.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-[#202630]">{a.order_number}</span>
                      <span className="text-xs font-semibold text-[#16835D]">
                        {DELIVERY_STATUS_LABELS[a.status] || a.status}
                      </span>
                    </div>
                    <div className="text-sm font-medium">{a.customer_name} · {a.customer_phone}</div>
                    <div className="flex items-center gap-1.5 text-xs text-[#526071]">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-[#D71920]" />
                      <span>{a.line1}{a.landmark ? `, ${a.landmark}` : ''}, {a.city}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <div className="text-right tabular-nums">
                      <div className="text-sm font-bold">{formatINRPaise(a.total_paise)}</div>
                      <div className="text-[11px] text-[#526071]">{a.payment_method} ({a.payment_status})</div>
                    </div>
                    <Link to={`/delivery/order/${a.order_id}`}>
                      <Button variant="secondary" className="min-h-[44px]">Execute →</Button>
                    </Link>
                  </div>
                </Card>
              ))
            )}
          </div>

          {/* Notifications + Store Support */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <Bell className="h-4 w-4 text-[#16835D]" />
                  Recent Dispatch Alerts ({data.stats.unreadNotifications} unread)
                </h3>
                {data.stats.unreadNotifications > 0 && (
                  <button
                    type="button"
                    onClick={() => apiFetch('/api/delivery/notifications/mark-read', { method: 'POST' }).then(load)}
                    className="text-xs text-[#16835D] hover:underline cursor-pointer"
                  >
                    Mark Read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className="text-xs text-[#526071]">No notifications yet.</p>
              ) : (
                <div className="divide-y divide-[#E1E5EB] max-h-44 overflow-y-auto">
                  {notifications.slice(0, 6).map((n) => (
                    <div key={n.id} className="py-2 text-xs">
                      <div className="font-semibold text-[#202630]">{n.title}</div>
                      <div className="text-[#526071]">{n.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4 space-y-2.5">
              <h3 className="text-sm font-bold text-[#202630]">Pharmacy Dispatch Support</h3>
              <p className="text-xs text-[#526071]">
                {data.store.name} · {data.store.addressLine1}, {data.store.city} ({data.store.operatingHours})
              </p>
              <a
                href={`tel:${data.store.phone}`}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-[#16835D] bg-[#F0FDF4] px-4 text-xs font-semibold text-[#16835D]"
              >
                <Phone className="h-4 w-4" />
                Call Store Desk ({data.store.phone})
              </a>
            </Card>
          </div>
        </div>
      )}

      {/* Rejection Reason Dialog */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-5 space-y-4">
            <h3 className="text-base font-bold text-[#202630]">
              Reject Assignment {rejectTarget.order_number}
            </h3>
            <form onSubmit={handleReject} className="space-y-3">
              <div>
                <Label>Reason for Rejection *</Label>
                <Textarea
                  required
                  minLength={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Vehicle issue, battery low, outside current zone"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setRejectTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive">Confirm Rejection</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </DeliveryLayout>
  );
}

export function DeliveryAssignmentsPage() {
  const { showToast } = useApp();
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [store, setStore] = useState<PublicStoreInfo | null>(null);

  const load = () => {
    apiFetch<{ assignments: AssignmentSummary[]; store: PublicStoreInfo }>('/api/delivery/assignments')
      .then((d) => {
        setAssignments(d.assignments);
        setStore(d.store);
      })
      .catch(console.error);
  };

  useEffect(() => {
    load();
  }, []);

  const acceptQuick = async (orderId: string) => {
    try {
      await apiFetch(`/api/delivery/orders/${orderId}/accept`, { method: 'POST', body: JSON.stringify({}) });
      showToast('Assignment accepted');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to accept', 'error');
    }
  };

  return (
    <DeliveryLayout title="Assigned Orders">
      <div className="space-y-3">
        {assignments.length === 0 ? (
          <Card className="p-8 text-center text-sm text-[#526071]">
            No pending or active delivery assignments.
          </Card>
        ) : (
          assignments.map((a) => (
            <Card key={a.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold">{a.order_number}</span>
                  <span className="text-xs font-semibold text-[#16835D]">
                    {DELIVERY_STATUS_LABELS[a.status] || a.status}
                  </span>
                  {a.priority === 'URGENT' && <span className="text-xs font-bold text-[#D71920]">URGENT</span>}
                </div>
                <div className="text-xs text-[#526071]">
                  Pickup: {store?.addressLine1 || 'Store'}
                  {a.pickup_time_target ? ` · Target ${formatIndianDateTime(a.pickup_time_target)}` : ''}
                </div>
                <div className="text-sm font-medium">{a.customer_name} ({a.customer_phone})</div>
                <div className="text-xs text-[#526071]">
                  {a.line1}, {a.city} — {a.postal_code}
                  {a.estimated_distance_km ? ` · ~${a.estimated_distance_km} km` : ''}
                </div>
                <div className="text-xs font-semibold text-[#202630] tabular-nums">
                  {a.payment_method === 'CASH_ON_DELIVERY'
                    ? `Collect COD: ${formatINRPaise(a.total_paise)}`
                    : `Prepaid (${a.payment_status})`}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {a.status === DeliveryAssignmentStatus.ASSIGNED && (
                  <Button variant="secondary" className="min-h-[44px]" onClick={() => acceptQuick(a.order_id)}>
                    Accept
                  </Button>
                )}
                <Link to={`/delivery/order/${a.order_id}`}>
                  <Button variant="outline" className="min-h-[44px]">Open Order</Button>
                </Link>
              </div>
            </Card>
          ))
        )}
      </div>
    </DeliveryLayout>
  );
}

const ORDERED_WORKFLOW_STEPS: Array<{ status: DeliveryAssignmentStatus; label: string }> = [
  { status: DeliveryAssignmentStatus.ACCEPTED, label: 'Accepted' },
  { status: DeliveryAssignmentStatus.ARRIVED_AT_STORE, label: 'Arrived at Store' },
  { status: DeliveryAssignmentStatus.PICKED_UP, label: 'Picked Up' },
  { status: DeliveryAssignmentStatus.OUT_FOR_DELIVERY, label: 'Out for Delivery' },
  { status: DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER, label: 'Arrived at Customer' },
  { status: DeliveryAssignmentStatus.DELIVERED, label: 'Delivered' },
];

export function DeliveryOrderDetailPage() {
  const { id } = useParams();
  const { showToast } = useApp();
  const isOnline = useOnlineStatus();

  const [detail, setDetail] = useState<{
    assignment: AssignmentSummary & {
      delivery_notes: string | null;
      otp_required: number;
      delivery_otp_attempts: number;
      delivery_otp_locked_until: string | null;
      dest_lat: number | null;
      dest_lng: number | null;
      pod_photo_url?: string | null;
      signed_pod_photo_url?: string | null;
    };
    items: Array<{ id: string; medicine_name: string; pack_size: string; quantity: number }>;
    partner: PartnerSummary;
    store: PublicStoreInfo;
    allowedNextStates: DeliveryAssignmentStatus[];
  } | null>(null);

  const [telemetry, setTelemetry] = useState<TrackingTelemetrySnapshot>(() => deliveryTracker.getSnapshot());
  const [trackingConsentGiven, setTrackingConsentGiven] = useState(false);

  const [otp, setOtp] = useState('');
  const [proofNote, setProofNote] = useState('');
  const [cashCollectedRupees, setCashCollectedRupees] = useState('');
  const [podPhotoUrl, setPodPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [exceptionStatus, setExceptionStatus] = useState<'DELIVERY_FAILED' | 'RETURNING_TO_STORE' | 'RETURNED' | null>(null);
  const [exceptionReason, setExceptionReason] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const drawingRef = useRef(false);

  const load = () => {
    if (!id) return;
    apiFetch<typeof detail>(`/api/delivery/orders/${id}`)
      .then((res) => {
        setDetail(res);
        if (res?.assignment.payment_method === 'CASH_ON_DELIVERY' && !cashCollectedRupees) {
          setCashCollectedRupees(String((res.assignment.total_paise || 0) / 100));
        }
        if (res?.assignment.signed_pod_photo_url || res?.assignment.pod_photo_url) {
          setPodPhotoUrl(res.assignment.signed_pod_photo_url || res.assignment.pod_photo_url || null);
        }
        if (res?.assignment) {
          cacheEssentialAssignment({
            orderId: res.assignment.order_id,
            orderNumber: res.assignment.order_number,
            status: res.assignment.status,
            customerName: res.assignment.customer_name,
            customerPhone: res.assignment.customer_phone,
            addressSummary: `${res.assignment.line1 || ''}, ${res.assignment.city || ''}`,
            paymentMethod: res.assignment.payment_method,
            paymentStatus: res.assignment.payment_status,
            totalPaise: res.assignment.total_paise,
            deliveryNotes: res.assignment.delivery_notes,
            cachedAt: new Date().toISOString(),
          });
        }
      })
      .catch(console.error);
  };

  useEffect(() => {
    load();
    return () => {
      deliveryTracker.stop();
    };
  }, [id]);

  // Stop live GPS immediately when assignment completes/cancels/returns
  useEffect(() => {
    if (!detail) return;
    const isTrackable = TRACKABLE_ASSIGNMENT_STATUSES.includes(
      detail.assignment.status as DeliveryAssignmentStatus
    );
    if (!isTrackable) {
      deliveryTracker.stop();
      setTrackingConsentGiven(false);
    }
  }, [detail?.assignment.status]);

  const startLiveGpsWithConsent = async () => {
    if (!detail) return;
    setTrackingConsentGiven(true);
    await deliveryTracker.start({
      activeAssignmentOrderId: detail.assignment.order_id,
      onTelemetry: (snap) => {
        setTelemetry(snap);
      },
    });
  };

  const updateDeliveryStatus = async (status: DeliveryAssignmentStatus, extraReason?: string) => {
    if (!detail) return;

    if (!isOnline) {
      if (status === DeliveryAssignmentStatus.DELIVERED) {
        showToast('Online connection is required to verify OTP and complete delivery', 'error');
        return;
      }
      enqueueOfflineStatusUpdate({
        orderId: detail.assignment.order_id,
        orderNumber: detail.assignment.order_number,
        status,
        proofNote: proofNote || undefined,
        reason: extraReason || undefined,
      });
      showToast(`Offline: ${status} queued for automatic sync upon reconnect`);
      return;
    }

    let signatureDataUrl: string | undefined;
    if (status === DeliveryAssignmentStatus.DELIVERED && hasSignature && canvasRef.current) {
      signatureDataUrl = canvasRef.current.toDataURL('image/png');
    }

    const cashPaise =
      status === DeliveryAssignmentStatus.DELIVERED && detail.assignment.payment_method === 'CASH_ON_DELIVERY'
        ? Math.round(Number(cashCollectedRupees || detail.assignment.total_paise / 100) * 100)
        : undefined;

    try {
      await apiFetch(`/api/delivery/orders/${detail.assignment.order_id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          otp: otp || undefined,
          proofNote: proofNote || undefined,
          reason: extraReason || undefined,
          signatureDataUrl,
          podPhotoUrl: podPhotoUrl || undefined,
          cashCollectedPaise: cashPaise,
        }),
      });
      showToast(`Status advanced to ${DELIVERY_STATUS_LABELS[status] || status}`);
      setExceptionStatus(null);
      setExceptionReason('');
      load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Status update failed', 'error');
    }
  };

  const handlePodPhotoUpload = async (file: File) => {
    if (!detail) return;
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch<{ podPhotoUrl: string }>(
        `/api/delivery/orders/${detail.assignment.order_id}/pod-photo`,
        { method: 'POST', body: fd }
      );
      setPodPhotoUrl(res.podPhotoUrl);
      showToast('Proof of delivery photo attached');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Photo upload failed', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Signature Pad drawing handlers
  const getCanvasPoint = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawingRef.current = true;
    const pt = getCanvasPoint(e);
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };

  const moveDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pt = getCanvasPoint(e);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#202630';
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const endDraw = () => {
    drawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasSignature(false);
    }
  };

  const isTrackable = Boolean(
    detail && TRACKABLE_ASSIGNMENT_STATUSES.includes(detail.assignment.status as DeliveryAssignmentStatus)
  );
  const currentStepIdx = detail
    ? ORDERED_WORKFLOW_STEPS.findIndex((s) => s.status === detail.assignment.status)
    : -1;
  const nextWorkflowStep =
    currentStepIdx >= 0 && currentStepIdx < ORDERED_WORKFLOW_STEPS.length - 1
      ? ORDERED_WORKFLOW_STEPS[currentStepIdx + 1]
      : null;

  return (
    <DeliveryLayout title="Delivery Execution">
      {!detail ? (
        <div className="h-64 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
            <LiveRouteMap
              storeLat={detail.store.latitude}
              storeLng={detail.store.longitude}
              storeName={detail.store.name}
              driverLat={telemetry.latitude ?? detail.partner.current_lat}
              driverLng={telemetry.longitude ?? detail.partner.current_lng}
              driverLabel={detail.partner.full_name}
              destLat={detail.assignment.dest_lat || 19.2869}
              destLng={detail.assignment.dest_lng || 72.8716}
              destLabel={detail.assignment.customer_name}
              directionsUrl={`https://www.google.com/maps/dir/?api=1&origin=${detail.store.latitude},${detail.store.longitude}&destination=${detail.assignment.dest_lat || 19.2869},${detail.assignment.dest_lng || 72.8716}&travelmode=driving`}
            />

            {/* Explicit GPS Permission, WatchPosition Stream & Connectivity Diagnostics */}
            <Card className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-[#202630] flex items-center gap-1.5">
                    <LocateFixed className="h-4 w-4 text-[#16835D]" />
                    Real-Time GPS Broadcast
                  </div>
                  <div className="text-xs text-[#526071] font-mono tabular-nums">
                    {telemetry.latitude && telemetry.longitude
                      ? `${telemetry.latitude.toFixed(5)}, ${telemetry.longitude.toFixed(5)} (±${Math.round(telemetry.accuracyM || 0)}m)`
                      : detail.partner.current_lat && detail.partner.current_lng
                        ? `Last recorded: ${detail.partner.current_lat.toFixed(4)}, ${detail.partner.current_lng.toFixed(4)}`
                        : 'Awaiting device GPS lock'}
                  </div>
                </div>
                <span
                  className={`text-xs font-bold ${
                    telemetry.status === 'TRACKING'
                      ? 'text-[#16835D]'
                      : telemetry.status === 'IDLE'
                        ? 'text-[#526071]'
                        : 'text-[#D97706]'
                  }`}
                >
                  {telemetry.status.replace(/_/g, ' ')}
                </span>
              </div>

              {telemetry.errorMessage && (
                <div className="flex items-start gap-2 rounded-md border border-[#F59E0B] bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{telemetry.errorMessage}</span>
                </div>
              )}

              {telemetry.isSuspiciousFlagged && (
                <div className="flex items-start gap-2 rounded-md border border-[#F5C2C7] bg-[#FFF5F5] p-3 text-xs text-[#B5121B]">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Server flagged last GPS coordinate jump as anomalous. Keep GPS stabilized outdoors.</span>
                </div>
              )}

              {!isTrackable ? (
                <p className="text-xs text-[#526071]">
                  Live GPS tracking activates only after accepting an assignment and stops automatically upon delivery completion or return.
                </p>
              ) : !trackingConsentGiven || telemetry.status === 'IDLE' ? (
                <div className="rounded-md border border-[#E1E5EB] bg-[#F5F7FA] p-3 space-y-2.5">
                  <p className="text-xs text-[#202630]">
                    <strong>Location Authorization:</strong> Sharing live GPS allows the pharmacy and customer to track order{' '}
                    <span className="font-mono">{detail.assignment.order_number}</span> every 5–10 seconds while in transit. Keep the browser open during travel.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full min-h-[44px]"
                    onClick={startLiveGpsWithConsent}
                  >
                    <LocateFixed className="h-4 w-4" />
                    Authorize &amp; Start Live GPS Tracking
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {telemetry.status === 'PAUSED' ? (
                    <Button type="button" variant="secondary" className="min-h-[44px]" onClick={() => deliveryTracker.resume()}>
                      <Play className="h-4 w-4" />
                      Resume GPS
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => deliveryTracker.pause()}>
                      <Pause className="h-4 w-4" />
                      Pause GPS
                    </Button>
                  )}
                  <Button type="button" variant="outline" className="min-h-[44px]" onClick={startLiveGpsWithConsent}>
                    <RefreshCw className="h-4 w-4" />
                    Retry / Re-acquire Fix
                  </Button>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&origin=${detail.store.latitude},${detail.store.longitude}&destination=${detail.assignment.dest_lat || 19.2869},${detail.assignment.dest_lng || 72.8716}&travelmode=driving`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-[#E1E5EB] px-3 text-xs font-semibold text-[#D71920]"
                  >
                    <Navigation className="h-4 w-4" />
                    Open Turn-by-Turn Maps
                  </a>
                </div>
              )}
              {telemetry.lastSentAt && (
                <div className="text-[11px] text-[#526071] tabular-nums">
                  Last transmitted to server: {formatIndianDateTime(telemetry.lastSentAt)}
                </div>
              )}
            </Card>
          </div>

          {/* Right Column: Order Instructions, Package Items, Strict State Workflow & POD */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#E1E5EB] pb-3">
                <div>
                  <div className="font-mono text-base font-bold">{detail.assignment.order_number}</div>
                  <div className="text-xs font-semibold text-[#16835D]">
                    {DELIVERY_STATUS_LABELS[detail.assignment.status] || detail.assignment.status}
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  <div className="text-base font-bold">{formatINRPaise(detail.assignment.total_paise)}</div>
                  <div className="text-xs text-[#526071]">
                    {detail.assignment.payment_method} ({detail.assignment.payment_status})
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="rounded bg-[#F5F7FA] p-2.5 text-[#526071]">
                  <strong className="text-[#202630]">Pickup Pharmacy:</strong> {detail.store.name}, {detail.store.addressLine1}
                </div>
                <div className="font-bold text-sm text-[#202630] pt-1">{detail.assignment.customer_name}</div>
                <a href={`tel:${detail.assignment.customer_phone}`} className="inline-flex items-center gap-1.5 text-[#16835D] font-semibold">
                  <Phone className="h-3.5 w-3.5" />
                  {detail.assignment.customer_phone}
                </a>
                <div className="text-[#526071]">
                  {detail.assignment.line1}{detail.assignment.landmark ? `, ${detail.assignment.landmark}` : ''},{' '}
                  {detail.assignment.city} — {detail.assignment.postal_code}
                </div>
                {detail.assignment.delivery_notes && (
                  <div className="rounded border border-[#E1E5EB] bg-[#FFFBEB] p-2 text-[#92400E]">
                    Instructions: {detail.assignment.delivery_notes}
                  </div>
                )}
              </div>

              {/* Package Items (Strictly no prescription clinical records) */}
              <div className="border-t border-[#E1E5EB] pt-3 space-y-1 text-xs">
                <div className="font-semibold text-[#202630]">Package Manifest ({detail.items.length} items)</div>
                {detail.items.map((it) => (
                  <div key={it.id} className="flex justify-between">
                    <span>{it.medicine_name} ({it.pack_size})</span>
                    <span className="font-semibold tabular-nums">×{it.quantity}</span>
                  </div>
                ))}
              </div>

              {/* Strict State Machine Workflow Action Controls */}
              <div className="border-t border-[#E1E5EB] pt-3 space-y-3">
                {detail.assignment.status === DeliveryAssignmentStatus.ASSIGNED && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="secondary"
                      className="min-h-[44px]"
                      onClick={() => updateDeliveryStatus(DeliveryAssignmentStatus.ACCEPTED)}
                    >
                      Accept Assignment
                    </Button>
                    <Button
                      variant="destructive"
                      className="min-h-[44px]"
                      onClick={() => setExceptionStatus('DELIVERY_FAILED')}
                    >
                      Reject / Cannot Take
                    </Button>
                  </div>
                )}

                {nextWorkflowStep && nextWorkflowStep.status !== DeliveryAssignmentStatus.DELIVERED && (
                  <Button
                    variant="secondary"
                    className="w-full min-h-[48px] text-sm"
                    onClick={() => updateDeliveryStatus(nextWorkflowStep.status)}
                  >
                    Advance to: {nextWorkflowStep.label} →
                  </Button>
                )}

                {/* Proof of Delivery Section when Arrived at Customer */}
                {detail.assignment.status === DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER && (
                  <div className="space-y-3 rounded-md border border-[#16835D] bg-[#F0FDF4] p-3.5">
                    <div className="text-xs font-bold text-[#16835D]">
                      Proof of Delivery &amp; Handover Verification
                    </div>

                    {detail.assignment.otp_required === 1 && (
                      <div>
                        <Label>Ask Customer for 4-Digit Delivery OTP *</Label>
                        <Input
                          maxLength={6}
                          inputMode="numeric"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value)}
                          placeholder="Enter OTP shown in customer app"
                          className="h-11 text-base font-mono tracking-widest bg-white"
                        />
                        {detail.assignment.delivery_otp_attempts > 0 && (
                          <div className="text-[11px] text-[#B5121B] mt-1">
                            Failed OTP attempts: {detail.assignment.delivery_otp_attempts}/5
                          </div>
                        )}
                      </div>
                    )}

                    {detail.assignment.payment_method === 'CASH_ON_DELIVERY' && (
                      <div>
                        <Label>COD Cash Collected (INR ₹)</Label>
                        <Input
                          type="number"
                          value={cashCollectedRupees}
                          onChange={(e) => setCashCollectedRupees(e.target.value)}
                          className="h-11 bg-white tabular-nums"
                        />
                      </div>
                    )}

                    <div>
                      <Label>Customer Signature (Optional)</Label>
                      <canvas
                        ref={canvasRef}
                        width={320}
                        height={110}
                        onMouseDown={startDraw}
                        onMouseMove={moveDraw}
                        onMouseUp={endDraw}
                        onMouseLeave={endDraw}
                        onTouchStart={startDraw}
                        onTouchMove={moveDraw}
                        onTouchEnd={endDraw}
                        className="w-full h-28 rounded border border-[#CBD2D9] bg-white touch-none cursor-crosshair"
                      />
                      {hasSignature && (
                        <button
                          type="button"
                          onClick={clearSignature}
                          className="mt-1 text-[11px] text-[#D71920] hover:underline"
                        >
                          Clear signature
                        </button>
                      )}
                    </div>

                    <div>
                      <Label>Delivery Photo Proof (Optional)</Label>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-[#E1E5EB] bg-white px-3 text-xs font-medium cursor-pointer">
                          <Camera className="h-4 w-4 text-[#16835D]" />
                          <span>{uploadingPhoto ? 'Uploading...' : podPhotoUrl ? 'Photo Attached' : 'Capture / Upload Photo'}</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            capture="environment"
                            className="sr-only"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handlePodPhotoUpload(f);
                            }}
                          />
                        </label>
                        {podPhotoUrl && (
                          <span className="text-[11px] font-semibold text-[#16835D]">Saved</span>
                        )}
                      </div>
                    </div>

                    <div>
                      <Label>Handover Notes</Label>
                      <Input
                        value={proofNote}
                        onChange={(e) => setProofNote(e.target.value)}
                        placeholder="Handed to recipient / security desk"
                        className="bg-white"
                      />
                    </div>

                    <Button
                      variant="secondary"
                      className="w-full min-h-[48px]"
                      onClick={() => updateDeliveryStatus(DeliveryAssignmentStatus.DELIVERED)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Confirm Handover &amp; Complete Delivery
                    </Button>
                  </div>
                )}

                {/* Exception Actions */}
                {detail.allowedNextStates.some((s) =>
                  ['DELIVERY_FAILED', 'RETURNING_TO_STORE', 'RETURNED'].includes(s)
                ) && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-[#E1E5EB]">
                    {detail.allowedNextStates.includes(DeliveryAssignmentStatus.DELIVERY_FAILED) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-[#B5121B] min-h-[44px]"
                        onClick={() => setExceptionStatus('DELIVERY_FAILED')}
                      >
                        Report Failed Delivery
                      </Button>
                    )}
                    {detail.allowedNextStates.includes(DeliveryAssignmentStatus.RETURNING_TO_STORE) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        onClick={() => setExceptionStatus('RETURNING_TO_STORE')}
                      >
                        Returning to Pharmacy
                      </Button>
                    )}
                    {detail.allowedNextStates.includes(DeliveryAssignmentStatus.RETURNED) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        onClick={() => setExceptionStatus('RETURNED')}
                      >
                        Mark Returned at Store
                      </Button>
                    )}
                  </div>
                )}

                {exceptionStatus && (
                  <div className="rounded-md border border-[#F5C2C7] bg-[#FFF5F5] p-3 space-y-2">
                    <Label>Reason for {exceptionStatus.replace(/_/g, ' ')} *</Label>
                    <Textarea
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                      placeholder="Customer unreachable, gate closed, or medicine refused..."
                    />
                    <div className="flex gap-2 justify-end">
                      <Button type="button" variant="outline" size="sm" onClick={() => setExceptionStatus(null)}>
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => updateDeliveryStatus(exceptionStatus, exceptionReason)}
                      >
                        Submit Update
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </DeliveryLayout>
  );
}

export function DeliveryCashSummaryPage() {
  const [summary, setSummary] = useState<{
    totalCollectedPaise: number;
    settledPaise: number;
    pendingSettlementPaise: number;
    codDeliveries: Array<{
      id: string;
      order_number: string;
      collected_paise: number;
      cod_reconciled: number;
      cod_reconciled_at: string | null;
      delivered_at: string | null;
      customer_name: string;
    }>;
  } | null>(null);

  useEffect(() => {
    apiFetch<typeof summary>('/api/delivery/cash-summary').then(setSummary).catch(console.error);
  }, []);

  return (
    <DeliveryLayout title="Cash Collection Summary">
      {!summary ? (
        <div className="h-40 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Total COD Collected</div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{formatINRPaise(summary.totalCollectedPaise)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Settled with Pharmacy</div>
              <div className="mt-1 text-2xl font-bold text-[#16835D] tabular-nums">{formatINRPaise(summary.settledPaise)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-[#526071]">Pending Handover to Store</div>
              <div className="mt-1 text-2xl font-bold text-[#D71920] tabular-nums">{formatINRPaise(summary.pendingSettlementPaise)}</div>
            </Card>
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="border-b border-[#E1E5EB] bg-[#F5F7FA] px-4 py-3 text-xs font-bold flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-[#16835D]" />
              COD Collection Ledger
            </div>
            {summary.codDeliveries.length === 0 ? (
              <div className="p-6 text-sm text-[#526071]">No COD deliveries collected yet.</div>
            ) : (
              <div className="divide-y divide-[#E1E5EB]">
                {summary.codDeliveries.map((d) => (
                  <div key={d.id} className="px-4 py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-mono font-bold text-[#202630]">{d.order_number}</div>
                      <div className="text-[#526071]">
                        {d.customer_name} · {formatIndianDateTime(d.delivered_at)}
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="text-sm font-bold text-[#202630]">{formatINRPaise(d.collected_paise)}</div>
                      <div className={d.cod_reconciled ? 'text-[#16835D] font-semibold' : 'text-[#D97706] font-semibold'}>
                        {d.cod_reconciled ? 'Reconciled' : 'Pending Handover'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </DeliveryLayout>
  );
}

export function DeliveryHistoryPage() {
  const [history, setHistory] = useState<
    Array<{
      id: string;
      order_number: string;
      status: string;
      total_paise: number;
      payment_method: string;
      cash_collected_paise?: number | null;
      customer_name: string;
      line1: string;
      updated_at: string;
    }>
  >([]);

  useEffect(() => {
    apiFetch<{ history: typeof history }>('/api/delivery/history')
      .then((d) => setHistory(d.history))
      .catch(console.error);
  }, []);

  return (
    <DeliveryLayout title="Delivery History">
      <div className="space-y-3">
        {history.length === 0 ? (
          <Card className="p-8 text-center text-sm text-[#526071]">
            No completed or closed deliveries recorded yet.
          </Card>
        ) : (
          history.map((h) => (
            <Card key={h.id} className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-sm font-bold">{h.order_number}</div>
                <div className="text-xs text-[#526071]">
                  {h.customer_name} · {h.line1 || 'Mira Road East'} · {formatIndianDateTime(h.updated_at)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-[#16835D]">
                  {DELIVERY_STATUS_LABELS[h.status] || h.status}
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {formatINRPaise(h.cash_collected_paise ?? h.total_paise)}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </DeliveryLayout>
  );
}

export function DeliveryProfilePage() {
  const { showToast } = useApp();
  const [partner, setPartner] = useState<PartnerSummary & { email: string } | null>(null);

  useEffect(() => {
    apiFetch<{ partner: typeof partner }>('/api/delivery/profile')
      .then((d) => setPartner(d.partner))
      .catch(console.error);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partner) return;
    try {
      const res = await apiFetch<{ partner: typeof partner }>('/api/delivery/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          isAvailable: Boolean(partner.is_available),
          isOnShift: Boolean(partner.is_on_shift),
          vehicleType: partner.vehicle_type,
          vehicleNumber: partner.vehicle_number,
        }),
      });
      setPartner(res.partner);
      showToast('Delivery profile updated');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  return (
    <DeliveryLayout title="Delivery Partner Profile">
      {!partner ? (
        <div className="h-48 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
      ) : (
        <div className="space-y-4 max-w-lg">
          <Card className="p-6">
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <div className="text-base font-bold">{partner.full_name}</div>
                <div className="text-xs text-[#526071]">{partner.email} · {partner.phone}</div>
              </div>
              <div>
                <Label>Vehicle Type</Label>
                <Input
                  value={partner.vehicle_type}
                  onChange={(e) => setPartner({ ...partner, vehicle_type: e.target.value })}
                />
              </div>
              <div>
                <Label>Vehicle Registration</Label>
                <Input
                  value={partner.vehicle_number}
                  onChange={(e) => setPartner({ ...partner, vehicle_number: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={Boolean(partner.is_on_shift)}
                  onChange={(e) => setPartner({ ...partner, is_on_shift: e.target.checked ? 1 : 0 })}
                  className="accent-[#16835D] h-4 w-4"
                />
                Online Duty Status (Available for Dispatch)
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={Boolean(partner.is_available)}
                  onChange={(e) => setPartner({ ...partner, is_available: e.target.checked ? 1 : 0 })}
                  className="accent-[#16835D] h-4 w-4"
                />
                Ready to Accept New Orders
              </label>
              <Button type="submit" variant="secondary" className="min-h-[44px]">Save Profile</Button>
            </form>
          </Card>

          <Card className="p-4 space-y-2 text-xs text-[#526071]">
            <div className="font-bold text-[#202630] flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-[#16835D]" />
              Location Privacy &amp; PWA Tracking Notice
            </div>
            <p>
              GPS coordinates are transmitted strictly during accepted active deliveries and automatically pruned after 30 days. Because this runs as a mobile Web PWA, keep the browser screen active during trips; continuous screen-locked tracking requires the native Android Foreground Service wrapper documented in our system architecture.
            </p>
          </Card>
        </div>
      )}
    </DeliveryLayout>
  );
}
