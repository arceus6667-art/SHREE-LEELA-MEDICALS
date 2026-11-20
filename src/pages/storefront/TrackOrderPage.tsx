import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Phone,
  CheckCircle2,
  Clock,
  Bike,
  CreditCard,
  Store,
  ShieldCheck,
  AlertTriangle,
  Wifi,
  RefreshCw,
} from 'lucide-react';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { LiveRouteMap } from '../../components/LiveRouteMap.tsx';
import { ErrorStatePanel } from '../../components/ErrorStatePanel.tsx';
import { Button, Card } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { ApiError, apiFetch } from '../../lib/api.ts';
import {
  DELIVERY_STATUS_LABELS,
  formatIndianDateTime,
  formatINRPaise,
  ORDER_STATUS_LABELS,
  OrderStatus,
  PrescriptionStatus,
  TERMINAL_ORDER_STATUSES,
  type RazorpayOrderInitDTO,
} from '../../shared/types.ts';

interface TrackPayload {
  order: {
    id: string;
    order_number: string;
    status: OrderStatus;
    prescription_status: string;
    fulfillment_type?: string;
    total_paise: number;
    payment_method: string;
    payment_status: string;
    delivery_otp: string | null;
    recipient_name: string | null;
    line1: string | null;
    landmark: string | null;
    city: string | null;
    postal_code: string | null;
    invoice_number: string | null;
    created_at: string;
  };
  items: Array<{ id: string; medicine_name: string; pack_size: string; quantity: number; line_total_paise: number }>;
  history: Array<{ id: string; status: OrderStatus; note: string | null; created_at: string }>;
  assignment: {
    partner_first_name: string | null;
    partner_name: string;
    partner_phone: string | null;
    vehicle_type: string;
    vehicle_number: string;
    status: string;
    failure_reason?: string | null;
  } | null;
  store: {
    name: string;
    addressLine1: string;
    city: string;
    latitude: number;
    longitude: number;
    phone: string;
    googleMapsUrl: string;
  };
  tracking: {
    driverLat: number | null;
    driverLng: number | null;
    destLat: number;
    destLng: number;
    distanceKm: number | null;
    etaMinutes: number | null;
    etaUnavailableReason?: string | null;
    encodedPolyline?: string | null;
    lastLocationAt?: string | null;
    isLocationStale?: boolean;
    freshnessThresholdSec?: number;
    locationRevoked?: boolean;
    directionsUrl: string | null;
  };
  serverTimestamp?: string;
}

const DELIVERY_TIMELINE_STAGES: Array<{ key: OrderStatus; label: string }> = [
  { key: OrderStatus.ORDER_RECEIVED, label: 'Order received' },
  { key: OrderStatus.PRESCRIPTION_PENDING, label: 'Rx review' },
  { key: OrderStatus.CONFIRMED, label: 'Order confirmed' },
  { key: OrderStatus.PREPARING, label: 'Preparing' },
  { key: OrderStatus.PACKED, label: 'Packed' },
  { key: OrderStatus.DRIVER_ASSIGNED, label: 'Partner assigned' },
  { key: OrderStatus.OUT_FOR_DELIVERY, label: 'Out for delivery' },
  { key: OrderStatus.DELIVERED, label: 'Delivered' },
];

const PICKUP_TIMELINE_STAGES: Array<{ key: OrderStatus; label: string }> = [
  { key: OrderStatus.ORDER_RECEIVED, label: 'Order received' },
  { key: OrderStatus.PRESCRIPTION_PENDING, label: 'Rx review' },
  { key: OrderStatus.CONFIRMED, label: 'Order confirmed' },
  { key: OrderStatus.PREPARING, label: 'Preparing' },
  { key: OrderStatus.PACKED, label: 'Packed' },
  { key: OrderStatus.READY_FOR_PICKUP, label: 'Ready at counter' },
  { key: OrderStatus.COLLECTED, label: 'Collected' },
];

export function TrackOrderPage() {
  const { orderId } = useParams();
  const { showToast } = useApp();
  const [data, setData] = useState<TrackPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const lastSeqRef = useRef(0);

  const loadTracking = (usePoll = false) => {
    if (!orderId) return;
    const url = usePoll ? `/api/track/${orderId}/poll` : `/api/track/${orderId}`;
    apiFetch<TrackPayload>(url)
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((e: unknown) => {
        setError({
          code: e instanceof ApiError ? e.code : 'UNKNOWN',
          message: e instanceof Error ? e.message : 'Unable to load tracking data',
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTracking();
  }, [orderId]);

  useEffect(() => {
    if (!data?.order.id) return;
    const resolvedOrderId = data.order.id;
    const socket = io({
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
    });

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('join:order', resolvedOrderId);
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    const handleOrderChange = (ev: { seq?: number }) => {
      if (ev?.seq && ev.seq <= lastSeqRef.current) return;
      if (ev?.seq) lastSeqRef.current = ev.seq;
      loadTracking();
    };

    const handleDriverLoc = (loc: {
      seq?: number;
      latitude: number;
      longitude: number;
      recordedAt?: string;
    }) => {
      if (loc?.seq && loc.seq <= lastSeqRef.current) return;
      if (loc?.seq) lastSeqRef.current = loc.seq;
      setData((prev) => {
        if (!prev || prev.tracking.locationRevoked) return prev;
        return {
          ...prev,
          tracking: {
            ...prev.tracking,
            driverLat: loc.latitude,
            driverLng: loc.longitude,
            lastLocationAt: loc.recordedAt || new Date().toISOString(),
            isLocationStale: false,
          },
        };
      });
    };

    const handleStale = () => {
      setData((prev) =>
        prev
          ? {
              ...prev,
              tracking: {
                ...prev.tracking,
                isLocationStale: true,
              },
            }
          : prev
      );
    };

    socket.on('order.status.updated', handleOrderChange);
    socket.on('order:updated', handleOrderChange);
    socket.on('delivery.accepted', handleOrderChange);
    socket.on('delivery.completed', handleOrderChange);
    socket.on('payment.updated', handleOrderChange);
    socket.on('delivery.location.updated', handleDriverLoc);
    socket.on('driver:location', handleDriverLoc);
    socket.on('delivery.location.stale', handleStale);

    // Resilient HTTP polling fallback when socket drops or as periodic reconciliation
    const pollTimer = setInterval(() => {
      if (!TERMINAL_ORDER_STATUSES.includes(data.order.status)) {
        loadTracking(true);
      }
    }, 12000);

    return () => {
      clearInterval(pollTimer);
      socket.emit('leave:order', resolvedOrderId);
      socket.disconnect();
    };
  }, [data?.order.id, data?.order.status]);

  const handleRazorpayTestPay = async (simulateFailure = false) => {
    if (!data) return;
    setPaying(true);
    setPaymentError(null);
    try {
      const init = await apiFetch<RazorpayOrderInitDTO>('/api/payments/razorpay/create-order', {
        method: 'POST',
        body: JSON.stringify({ orderId: data.order.id, amountPaise: data.order.total_paise, method: 'UPI' }),
      });

      if (simulateFailure) {
        await apiFetch('/api/payments/razorpay/failure', {
          method: 'POST',
          body: JSON.stringify({
            orderId: data.order.id,
            gatewayOrderId: init.gatewayOrderId,
            reason: 'Test simulated payment decline',
          }),
        });
        setPaymentError('Simulated payment decline recorded. You can retry payment or continue with Cash on Delivery.');
        loadTracking();
        return;
      }

      const sim = await apiFetch<{ gatewayOrderId: string; gatewayPaymentId: string; paymentSignature: string }>(
        '/api/payments/razorpay/test-simulate-auth',
        {
          method: 'POST',
          body: JSON.stringify({ gatewayOrderId: init.gatewayOrderId }),
        }
      );

      const verified = await apiFetch<{ paymentReference: string }>('/api/payments/razorpay/verify', {
        method: 'POST',
        body: JSON.stringify({
          orderId: data.order.id,
          gatewayOrderId: sim.gatewayOrderId,
          gatewayPaymentId: sim.gatewayPaymentId,
          paymentSignature: sim.paymentSignature,
        }),
      });
      showToast(`Razorpay Test Payment verified (${verified.paymentReference})`);
      loadTracking();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed';
      setPaymentError(msg);
      showToast(msg, 'error');
    } finally {
      setPaying(false);
    }
  };

  const completedStatuses = new Set(data?.history.map((h) => h.status) || []);
  const rxApprovedOrNotReq =
    data?.order.prescription_status === PrescriptionStatus.APPROVED ||
    data?.order.prescription_status === PrescriptionStatus.NOT_REQUIRED;
  const isStorePickup = data?.order.fulfillment_type === 'STORE_PICKUP';
  const activeTimeline = isStorePickup ? PICKUP_TIMELINE_STAGES : DELIVERY_TIMELINE_STAGES;

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        {loading ? (
          <div className="h-80 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
        ) : error || !data ? (
          <ErrorStatePanel
            code={error?.code || 'UNKNOWN'}
            message={error?.message || 'Order not found'}
            onRetry={() => loadTracking(false)}
          />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E1E5EB] pb-4">
              <div>
                <div className="text-xs text-[#526071] flex flex-wrap items-center gap-2">
                  <span>Live Order Tracking</span>
                  <span aria-hidden="true" className="text-[#CBD2D9]">·</span>
                  <span className={`inline-flex items-center gap-1 font-medium ${socketConnected ? 'text-[#16835D]' : 'text-[#526071]'}`}>
                    <Wifi className="h-3 w-3" />
                    {socketConnected ? 'Real-time connected' : 'HTTP polling fallback active'}
                  </span>
                  {isStorePickup && (
                    <>
                      <span aria-hidden="true" className="text-[#CBD2D9]">·</span>
                      <span className="inline-flex items-center gap-1 font-bold text-[#16835D]">
                        <Store className="h-3 w-3" />
                        STORE PICKUP
                      </span>
                    </>
                  )}
                </div>
                <h1 className="text-2xl font-bold text-[#202630] font-mono">{data.order.order_number}</h1>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-base font-bold text-[#16835D]">
                    {data.assignment && data.order.status !== OrderStatus.DELIVERED && data.order.status !== OrderStatus.CANCELLED
                      ? DELIVERY_STATUS_LABELS[data.assignment.status] || ORDER_STATUS_LABELS[data.order.status]
                      : ORDER_STATUS_LABELS[data.order.status] || data.order.status}
                  </div>
                  {data.order.delivery_otp && data.order.status !== 'DELIVERED' && data.order.status !== 'CANCELLED' && (
                    <div className="text-xs text-[#526071] font-mono">
                      Handover OTP: <span className="font-bold text-[#202630]">{data.order.delivery_otp}</span>
                    </div>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => loadTracking(true)} aria-label="Refresh tracking">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {data.assignment?.status === 'DELIVERY_FAILED' && (
              <div className="flex items-start gap-2.5 rounded-md border border-[#F5C2C7] bg-[#FFF5F5] p-3.5 text-xs text-[#B5121B]">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Delivery Attempt Needs Attention</div>
                  <div>{data.assignment.failure_reason || 'Rider reported difficulty completing delivery. Contact pharmacy support.'}</div>
                </div>
              </div>
            )}

            {/* Progress Stepper */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#202630]">Order Progress Timeline</h2>
                {data.order.status === OrderStatus.CANCELLED && (
                  <span className="text-xs font-bold text-[#B5121B]">ORDER CANCELLED</span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {activeTimeline.map((stage) => {
                  const isCurrent = data.order.status === stage.key;
                  const isDone = completedStatuses.has(stage.key);
                  return (
                    <div
                      key={stage.key}
                      className={`rounded-md border p-2.5 text-xs ${
                        isCurrent
                          ? 'border-[#D71920] bg-[#FFF5F5] text-[#B5121B] font-bold'
                          : isDone
                            ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#16835D] font-semibold'
                            : 'border-[#E1E5EB] bg-[#F5F7FA] text-[#6B7686]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>{stage.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="lg:col-span-7 space-y-6">
                {!isStorePickup ? (
                  <LiveRouteMap
                    storeLat={data.store.latitude}
                    storeLng={data.store.longitude}
                    storeName={data.store.name}
                    driverLat={data.tracking.driverLat}
                    driverLng={data.tracking.driverLng}
                    driverLabel={data.assignment?.partner_first_name || 'Partner'}
                    destLat={data.tracking.destLat}
                    destLng={data.tracking.destLng}
                    destLabel={data.order.recipient_name || 'Delivery Address'}
                    distanceKm={data.tracking.distanceKm}
                    etaMinutes={data.tracking.etaMinutes}
                    etaUnavailableReason={data.tracking.etaUnavailableReason}
                    encodedPolyline={data.tracking.encodedPolyline}
                    lastLocationAt={data.tracking.lastLocationAt}
                    isLocationStale={data.tracking.isLocationStale}
                    locationRevoked={data.tracking.locationRevoked}
                    directionsUrl={data.tracking.directionsUrl}
                    googleMapsUrl={data.store.googleMapsUrl}
                  />
                ) : (
                  <Card className="p-5 space-y-2">
                    <h2 className="text-base font-bold text-[#202630] flex items-center gap-2">
                      <Store className="h-4 w-4 text-[#16835D]" />
                      Store Pickup Counter Details
                    </h2>
                    <p className="text-xs text-[#526071]">
                      {data.store.name}, {data.store.addressLine1}, {data.store.city}. Present order number{' '}
                      <strong className="font-mono text-[#202630]">{data.order.order_number}</strong>
                      {data.order.delivery_otp ? (
                        <>
                          {' '}and handover OTP <strong className="font-mono text-[#202630]">{data.order.delivery_otp}</strong>
                        </>
                      ) : null}{' '}
                      at the pharmacy counter.
                    </p>
                  </Card>
                )}

                <Card className="p-5 space-y-4">
                  <h2 className="text-base font-bold text-[#202630]">Detailed Delivery Timeline</h2>
                  <div className="space-y-3">
                    {data.history.map((h) => (
                      <div key={h.id} className="flex items-start gap-3 text-sm">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#16835D]" />
                        <div className="flex-1">
                          <div className="font-semibold text-[#202630]">
                            {ORDER_STATUS_LABELS[h.status] || h.status}
                          </div>
                          {h.note && <div className="text-xs text-[#526071]">{h.note}</div>}
                        </div>
                        <div className="text-xs text-[#526071] tabular-nums">
                          {formatIndianDateTime(h.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <div className="lg:col-span-5 space-y-6">
                {(data.order.payment_status === 'PENDING' || data.order.payment_status === 'FAILED') &&
                  data.order.status !== OrderStatus.CANCELLED &&
                  data.order.status !== OrderStatus.REJECTED && (
                  <Card className="p-5 space-y-3 border-[#F59E0B] bg-[#FFFBEB]">
                    <div className="flex items-center gap-2 text-sm font-bold text-[#202630]">
                      <CreditCard className="h-4 w-4 text-[#D71920]" />
                      <span>Payment Status: {data.order.payment_status}</span>
                    </div>
                    {paymentError && (
                      <ErrorStatePanel
                        code="PAYMENT_FAILED"
                        message={paymentError}
                        onRetry={() => handleRazorpayTestPay(false)}
                      />
                    )}
                    {rxApprovedOrNotReq ? (
                      <>
                        <p className="text-xs text-[#526071]">
                          Your prescription requirement is verified. Complete HMAC-verified online payment via Razorpay Test Mode or pay on delivery.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={paying}
                            onClick={() => handleRazorpayTestPay(false)}
                          >
                            {paying
                              ? 'Processing...'
                              : `Pay Now via Razorpay Test Mode (${formatINRPaise(data.order.total_paise)})`}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={paying}
                            onClick={() => handleRazorpayTestPay(true)}
                          >
                            Test Failure Recovery
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-[#92400E] flex items-start gap-1.5">
                        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          Online payment is locked until our registered pharmacist completes prescription review ({data.order.prescription_status}).
                        </span>
                      </p>
                    )}
                  </Card>
                )}

                {!isStorePickup && (
                  data.assignment ? (
                    <Card className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-bold text-[#202630] flex items-center gap-2">
                          <Bike className="h-4 w-4 text-[#16835D]" />
                          Assigned Delivery Partner
                        </h2>
                        <span className="text-xs font-semibold text-[#16835D]">
                          {DELIVERY_STATUS_LABELS[data.assignment.status] || data.assignment.status}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-[#202630]">
                        {data.assignment.partner_first_name || data.assignment.partner_name}
                      </div>
                      <div className="text-xs text-[#526071]">
                        {data.assignment.vehicle_type} · {data.assignment.vehicle_number}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {data.assignment.partner_phone && (
                          <a
                            href={`tel:${data.assignment.partner_phone}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-[#16835D] bg-[#F0FDF4] px-3 py-1.5 text-xs font-semibold text-[#16835D]"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            Call Partner
                          </a>
                        )}
                        <a
                          href={`tel:${data.store.phone}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#E1E5EB] px-3 py-1.5 text-xs font-medium text-[#202630]"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Store Support
                        </a>
                      </div>
                    </Card>
                  ) : (
                    <Card className="p-5 flex items-center gap-3 text-sm text-[#526071]">
                      <Clock className="h-5 w-5 text-[#D71920]" />
                      <span>Delivery partner will be assigned once pharmacy packing is complete.</span>
                    </Card>
                  )
                )}

                <Card className="p-5 space-y-3">
                  <h2 className="text-base font-bold text-[#202630]">Delivery &amp; Invoice Summary</h2>
                  {data.order.line1 && (
                    <div className="text-xs text-[#526071] space-y-1 border-b border-[#E1E5EB] pb-3">
                      <div className="font-semibold text-[#202630]">{data.order.recipient_name}</div>
                      <div>{data.order.line1}{data.order.landmark ? `, ${data.order.landmark}` : ''}</div>
                      <div>{data.order.city} — {data.order.postal_code}</div>
                    </div>
                  )}
                  <div className="space-y-1.5 text-xs">
                    {data.items.map((it) => (
                      <div key={it.id} className="flex justify-between">
                        <span>{it.medicine_name} × {it.quantity}</span>
                        <span className="tabular-nums font-medium">{formatINRPaise(it.line_total_paise)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between border-t border-[#E1E5EB] pt-3 text-sm font-bold">
                    <span>Total ({data.order.payment_method} · {data.order.payment_status})</span>
                    <span className="tabular-nums">{formatINRPaise(data.order.total_paise)}</span>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}
      </div>
    </StorefrontLayout>
  );
}
