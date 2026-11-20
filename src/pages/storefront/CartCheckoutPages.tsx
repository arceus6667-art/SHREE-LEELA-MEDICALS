import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Trash2,
  Plus,
  Minus,
  ShieldAlert,
  ArrowRight,
  Upload,
  Bookmark,
  CheckCircle2,
  MapPin,
  Store,
  CreditCard,
  AlertTriangle,
} from 'lucide-react';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { ErrorStatePanel } from '../../components/ErrorStatePanel.tsx';
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { ApiError, apiFetch, generateIdempotencyKey } from '../../lib/api.ts';
import {
  formatINRPaise,
  FulfillmentType,
  PaymentMethod,
  PrescriptionStatus,
  type MedicineDTO,
  type RazorpayOrderInitDTO,
} from '../../shared/types.ts';

export function CartPage() {
  const {
    cart,
    store,
    deliveryLocation,
    updateCartQty,
    removeFromCart,
    saveForLater,
    moveToCart,
    addToCart,
  } = useApp();
  const navigate = useNavigate();

  const items = cart?.items || [];
  const savedItems: MedicineDTO[] = cart?.savedForLater || [];
  const subtotal = cart?.subtotalPaise || 0;
  const threshold = store?.freeDeliveryThresholdPaise ?? 49900;
  const baseDeliveryFee = deliveryLocation.serviceable
    ? deliveryLocation.deliveryFeePaise
    : (store?.deliveryFeePaise ?? 2500);
  const deliveryFee = subtotal >= threshold || subtotal === 0 ? 0 : baseDeliveryFee;
  const grandTotal = subtotal + deliveryFee;

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
        <div className="border-b border-[#E1E5EB] pb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-[#202630]">Shopping Cart</h1>
            <p className="mt-1 text-xs text-[#526071]">
              Server-validated medicine pricing, unexpired store stock, and Mira Road delivery estimates
            </p>
          </div>
          <div className="text-xs text-[#526071] flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-[#D71920]" />
            <span>
              PIN <strong className="text-[#202630]">{deliveryLocation.pincode}</strong> ·{' '}
              {deliveryLocation.serviceable
                ? `Est. ${deliveryLocation.estimatedMins || 35} mins`
                : 'Store Pickup Only'}
            </span>
          </div>
        </div>

        {items.length === 0 ? (
          <Card className="p-10 text-center space-y-4">
            <h2 className="text-lg font-bold text-[#202630]">Your pharmacy cart is empty</h2>
            <p className="text-sm text-[#526071]">
              Browse our catalog or move items from Saved for Later to begin your order.
            </p>
            <div className="flex justify-center gap-3">
              <Link to="/pharmacy">
                <Button>Browse Medicines</Button>
              </Link>
              <Link to="/quick-order">
                <Button variant="outline">Quick Order</Button>
              </Link>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="lg:col-span-8 space-y-3">
              {cart?.requiresPrescription && (
                <div className="flex items-start gap-2.5 rounded-md border border-[#F5C2C7] bg-[#FFF5F5] p-3.5 text-xs text-[#B5121B]">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-semibold">Prescription Required for Order Dispatch</div>
                    <div className="mt-0.5 text-[#526071]">
                      One or more medicines in your cart are Schedule H / H1. You will attach a prescription during checkout and our pharmacist will verify it before dispatch.
                    </div>
                  </div>
                </div>
              )}

              {items.map((item) => (
                <Card key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <img
                      src={item.imageUrl || '/src/assets/images/demo_med_tablets_1795159503038.jpg'}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      className="h-16 w-16 rounded border border-[#E1E5EB] object-cover shrink-0 bg-[#F5F7FA]"
                    />
                    <div className="min-w-0">
                      <Link
                        to={`/medicine/${item.slug}`}
                        className="text-sm font-semibold text-[#202630] hover:text-[#D71920] line-clamp-1"
                      >
                        {item.name}
                      </Link>
                      <div className="text-xs text-[#526071]">
                        {item.manufacturerName} · {item.packSize} ·{' '}
                        <span className={item.requiresPrescription ? 'text-[#B5121B] font-semibold' : 'text-[#16835D]'}>
                          {item.requiresPrescription ? 'Rx Required' : 'OTC'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline gap-2 tabular-nums">
                        <span className="text-sm font-bold text-[#202630]">
                          {formatINRPaise(item.salePricePaise)}
                        </span>
                        {item.mrpPaise > item.salePricePaise && (
                          <span className="text-xs text-[#6B7686] line-through">
                            {formatINRPaise(item.mrpPaise)}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => saveForLater(item.medicineId)}
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#526071] hover:text-[#D71920] cursor-pointer"
                      >
                        <Bookmark className="h-3 w-3" />
                        Save for later
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                    <div className="flex items-center rounded-md border border-[#E1E5EB]">
                      <button
                        type="button"
                        aria-label="Decrease quantity"
                        onClick={() => updateCartQty(item.medicineId, item.quantity - 1)}
                        className="h-9 w-9 flex items-center justify-center hover:bg-[#F5F7FA] cursor-pointer"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-9 text-center text-sm font-semibold tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="Increase quantity"
                        onClick={() => updateCartQty(item.medicineId, item.quantity + 1)}
                        className="h-9 w-9 flex items-center justify-center hover:bg-[#F5F7FA] cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="w-20 text-right text-sm font-bold tabular-nums">
                      {formatINRPaise(item.salePricePaise * item.quantity)}
                    </div>
                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => removeFromCart(item.medicineId)}
                      className="p-2 text-[#6B7686] hover:text-[#B5121B] cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Card>
              ))}
            </div>

            <div className="lg:col-span-4">
              <Card className="p-5 space-y-4">
                <h2 className="text-base font-bold text-[#202630] border-b border-[#E1E5EB] pb-3">
                  Order Summary
                </h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#526071]">Total MRP</span>
                    <span className="tabular-nums text-[#526071]">
                      {formatINRPaise(cart?.mrpTotalPaise || subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#526071]">Items Subtotal</span>
                    <span className="font-medium tabular-nums">{formatINRPaise(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#526071]">Catalog Discount</span>
                    <span className="font-medium text-[#16835D] tabular-nums">
                      −{formatINRPaise(cart?.savingsPaise || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#526071]">
                      Delivery Fee ({deliveryLocation.pincode})
                    </span>
                    <span className="font-medium tabular-nums">
                      {deliveryFee === 0 ? 'Free' : formatINRPaise(deliveryFee)}
                    </span>
                  </div>
                  {subtotal < threshold && (
                    <p className="text-xs text-[#526071]">
                      Add {formatINRPaise(threshold - subtotal)} more for free home delivery, or choose Store Pickup at checkout.
                    </p>
                  )}
                  <div className="flex justify-between border-t border-[#E1E5EB] pt-3 text-base font-bold">
                    <span>Estimated Total</span>
                    <span className="tabular-nums">{formatINRPaise(grandTotal)}</span>
                  </div>
                </div>

                <Button className="w-full" size="lg" onClick={() => navigate('/checkout')}>
                  Proceed to 7-Step Checkout
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Card>
            </div>
          </div>
        )}

        {savedItems.length > 0 && (
          <section className="space-y-3 border-t border-[#E1E5EB] pt-6">
            <h2 className="text-base font-bold text-[#202630]">
              Saved for Later ({savedItems.length})
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {savedItems.map((med) => (
                <Card key={med.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/medicine/${med.slug}`}
                      className="text-sm font-semibold text-[#202630] hover:text-[#D71920] line-clamp-1"
                    >
                      {med.name}
                    </Link>
                    <div className="text-xs text-[#526071]">{med.packSize}</div>
                    <div className="text-sm font-bold tabular-nums mt-0.5">
                      {formatINRPaise(med.salePricePaise)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!med.canPurchase}
                    onClick={() => (med.canPurchase ? moveToCart(med.id) : addToCart(med.id, 1))}
                  >
                    Move to Cart
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </StorefrontLayout>
  );
}

interface AddressRow {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  flat_building: string | null;
  society_name: string | null;
  street: string | null;
  line1: string;
  landmark: string | null;
  city: string;
  state: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  is_default: number;
}

interface PrescriptionRow {
  id: string;
  patient_name: string;
  status: string;
  created_at: string;
}

const CHECKOUT_STEPS = [
  '1. Account',
  '2. Address',
  '3. Serviceability',
  '4. Prescription',
  '5. Review',
  '6. Fulfillment & Pay',
  '7. Confirm',
];

export function CheckoutPage() {
  const { user, cart, store, deliveryLocation, refreshCart, showToast } = useApp();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [showNewAddr, setShowNewAddr] = useState(false);
  const [newAddr, setNewAddr] = useState({
    label: 'Home',
    recipientName: user?.fullName || '',
    phone: user?.phone || '',
    flatBuilding: '',
    societyName: '',
    street: '',
    landmark: '',
    city: 'Mira Road East',
    state: 'Maharashtra',
    postalCode: deliveryLocation.pincode || '401107',
    latitude: '19.2845',
    longitude: '72.8745',
  });

  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>(FulfillmentType.DELIVERY);
  const [serviceability, setServiceability] = useState<{
    checkedPin: string;
    serviceable: boolean;
    areaName: string | null;
    deliveryFeePaise: number;
    estimatedMins: number | null;
  } | null>(null);

  const [prescriptions, setPrescriptions] = useState<PrescriptionRow[]>([]);
  const [selectedRxId, setSelectedRxId] = useState('');
  const [rxFile, setRxFile] = useState<File | null>(null);
  const [uploadingRx, setUploadingRx] = useState(false);

  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discountPaise: number;
    description: string;
  } | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.RAZORPAY_TEST);
  const [selectedGatewaySubMethod, setSelectedGatewaySubMethod] = useState<'UPI' | 'CARD' | 'NETBANKING'>('UPI');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [placingOrder, setPlacingOrder] = useState(false);
  const [razorpayModalOpen, setRazorpayModalOpen] = useState(false);
  const [razorpayOrder, setRazorpayOrder] = useState<RazorpayOrderInitDTO | null>(null);
  const [checkoutError, setCheckoutError] = useState<{ code?: string; message: string } | null>(null);
  const [checkoutIdemKey, setCheckoutIdemKey] = useState(() => generateIdempotencyKey('ord'));

  useEffect(() => {
    if (!user) return;
    apiFetch<{ addresses: AddressRow[] }>('/api/addresses')
      .then((d) => {
        setAddresses(d.addresses);
        if (d.addresses.length > 0) setSelectedAddressId(d.addresses[0].id);
        else setShowNewAddr(true);
      })
      .catch(console.error);

    apiFetch<{ prescriptions: PrescriptionRow[] }>('/api/prescriptions')
      .then((d) => {
        setPrescriptions(d.prescriptions);
        if (d.prescriptions.length > 0) setSelectedRxId(d.prescriptions[0].id);
      })
      .catch(console.error);
  }, [user]);

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId) || null;

  useEffect(() => {
    const pin = selectedAddress?.postal_code;
    if (!pin) {
      setServiceability(null);
      return;
    }
    apiFetch<{
      serviceable: boolean;
      pincode: string;
      areaName: string | null;
      deliveryFeePaise: number;
      estimatedMins: number | null;
    }>(`/api/store/serviceability?pincode=${encodeURIComponent(pin)}`)
      .then((res) =>
        setServiceability({
          checkedPin: res.pincode,
          serviceable: res.serviceable,
          areaName: res.areaName,
          deliveryFeePaise: res.deliveryFeePaise,
          estimatedMins: res.estimatedMins,
        })
      )
      .catch(console.error);
  }, [selectedAddress?.postal_code]);

  if (!user) {
    return (
      <StorefrontLayout>
        <div className="mx-auto max-w-2xl px-4 py-12 space-y-4">
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
            {CHECKOUT_STEPS.map((s, idx) => (
              <span
                key={s}
                className={`rounded px-2 py-1 ${
                  idx === 0 ? 'bg-[#D71920] text-white' : 'bg-white border border-[#E1E5EB] text-[#526071]'
                }`}
              >
                {s}
              </span>
            ))}
          </div>
          <Card className="p-8 text-center space-y-4">
            <h1 className="text-xl font-bold text-[#202630]">Step 1: Sign in or Register to Continue Checkout</h1>
            <p className="text-sm text-[#526071]">
              Your shopping cart items are saved. Sign in or create a customer account to verify your delivery address and prescription.
            </p>
            <div className="flex justify-center gap-3">
              <Link to="/login?redirect=/checkout">
                <Button>Customer Sign In</Button>
              </Link>
              <Link to="/register?redirect=/checkout">
                <Button variant="outline">Create Account</Button>
              </Link>
            </div>
          </Card>
        </div>
      </StorefrontLayout>
    );
  }

  const items = cart?.items || [];
  if (items.length === 0) {
    return (
      <StorefrontLayout>
        <div className="mx-auto max-w-xl px-4 py-12">
          <Card className="p-8 text-center space-y-4">
            <h1 className="text-xl font-bold text-[#202630]">Your Cart is Empty</h1>
            <Link to="/pharmacy">
              <Button>Browse Medicines</Button>
            </Link>
          </Card>
        </div>
      </StorefrontLayout>
    );
  }

  const subtotal = cart?.subtotalPaise || 0;
  const threshold = store?.freeDeliveryThresholdPaise ?? 49900;
  const effectivePinFee = serviceability?.deliveryFeePaise ?? store?.deliveryFeePaise ?? 2500;
  const deliveryFee =
    fulfillmentType === FulfillmentType.STORE_PICKUP || subtotal >= threshold ? 0 : effectivePinFee;
  const discount = appliedCoupon?.discountPaise || 0;
  const grandTotal = Math.max(0, subtotal - discount + deliveryFee);

  const selectedRx = prescriptions.find((rx) => rx.id === selectedRxId) || null;
  const rxApprovedAlready = !cart?.requiresPrescription || selectedRx?.status === PrescriptionStatus.APPROVED;

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ address: AddressRow }>('/api/addresses', {
        method: 'POST',
        body: JSON.stringify({
          label: newAddr.label,
          recipientName: newAddr.recipientName,
          phone: newAddr.phone,
          flatBuilding: newAddr.flatBuilding,
          societyName: newAddr.societyName,
          street: newAddr.street,
          landmark: newAddr.landmark,
          city: newAddr.city,
          state: newAddr.state,
          postalCode: newAddr.postalCode,
          latitude: Number(newAddr.latitude) || undefined,
          longitude: Number(newAddr.longitude) || undefined,
          isDefault: addresses.length === 0,
        }),
      });
      setAddresses((prev) => [res.address, ...prev]);
      setSelectedAddressId(res.address.id);
      setShowNewAddr(false);
      showToast('Delivery address saved');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to save address', 'error');
    }
  };

  const handleQuickRxUpload = async () => {
    if (!rxFile) return;
    setUploadingRx(true);
    try {
      const fd = new FormData();
      fd.append('patientName', user.fullName);
      if (user.phone) fd.append('contactPhone', user.phone);
      fd.append('contactEmail', user.email);
      fd.append('file', rxFile);
      const res = await apiFetch<{ prescription: PrescriptionRow }>('/api/prescriptions', {
        method: 'POST',
        body: fd,
      });
      setPrescriptions((prev) => [res.prescription, ...prev]);
      setSelectedRxId(res.prescription.id);
      setRxFile(null);
      showToast('Prescription uploaded');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploadingRx(false);
    }
  };

  const handleApplyCoupon = async () => {
    try {
      const res = await apiFetch<{ coupon: { code: string; discountPaise: number; description: string } }>(
        '/api/coupons/validate',
        {
          method: 'POST',
          body: JSON.stringify({ code: couponInput, subtotalPaise: subtotal }),
        }
      );
      setAppliedCoupon(res.coupon);
      showToast(`Coupon ${res.coupon.code} applied`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Invalid coupon', 'error');
    }
  };

  const submitOrderRequest = async (paymentAuth?: {
    paymentReference: string;
    gatewayOrderId?: string;
    gatewayPaymentId?: string;
    paymentSignature?: string;
  }) => {
    setPlacingOrder(true);
    setCheckoutError(null);
    try {
      const res = await apiFetch<{ order: { id: string; orderNumber: string } }>('/api/orders', {
        method: 'POST',
        idempotencyKey: checkoutIdemKey,
        body: JSON.stringify({
          fulfillmentType,
          addressId: fulfillmentType === FulfillmentType.DELIVERY ? selectedAddressId : undefined,
          paymentMethod,
          paymentReference: paymentAuth?.paymentReference,
          gatewayOrderId: paymentAuth?.gatewayOrderId,
          gatewayPaymentId: paymentAuth?.gatewayPaymentId,
          paymentSignature: paymentAuth?.paymentSignature,
          couponCode: appliedCoupon?.code,
          prescriptionId: selectedRxId || undefined,
          deliveryNotes,
        }),
      });
      await refreshCart();
      setCheckoutIdemKey(generateIdempotencyKey('ord'));
      showToast(`Order ${res.order.orderNumber} submitted`);
      navigate(`/track/${res.order.orderNumber}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Order placement failed';
      const code = err instanceof ApiError ? err.code : 'UNKNOWN';
      setCheckoutError({ code, message: msg });
      showToast(msg, 'error');
      if (code === 'STOCK_CHANGED') {
        await refreshCart();
      }
      setCheckoutIdemKey(generateIdempotencyKey('ord'));
    } finally {
      setPlacingOrder(false);
      setRazorpayModalOpen(false);
    }
  };

  const handleAuthorizeRazorpayTest = async () => {
    if (!razorpayOrder) return;
    setPlacingOrder(true);
    setCheckoutError(null);
    try {
      const sim = await apiFetch<{
        gatewayOrderId: string;
        gatewayPaymentId: string;
        paymentSignature: string;
      }>('/api/payments/razorpay/test-simulate-auth', {
        method: 'POST',
        body: JSON.stringify({ gatewayOrderId: razorpayOrder.gatewayOrderId }),
      });
      await submitOrderRequest({
        paymentReference: sim.gatewayPaymentId,
        gatewayOrderId: sim.gatewayOrderId,
        gatewayPaymentId: sim.gatewayPaymentId,
        paymentSignature: sim.paymentSignature,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment authorization failed';
      setCheckoutError({ code: 'PAYMENT_FAILED', message: msg });
      setPlacingOrder(false);
      setRazorpayModalOpen(false);
    }
  };

  const handleSimulateRazorpayFailure = () => {
    setRazorpayModalOpen(false);
    setCheckoutError({
      code: 'PAYMENT_FAILED',
      message: 'Simulated Razorpay payment failure (Bank declined test transaction). Retry online payment or switch to Cash on Delivery.',
    });
    showToast('Test payment declined — no order was placed', 'error');
  };

  const handlePlaceOrderClick = async () => {
    setCheckoutError(null);
    if (fulfillmentType === FulfillmentType.DELIVERY) {
      if (!selectedAddressId) {
        setCheckoutError({ code: 'INVALID_ADDRESS', message: 'Please select or add a delivery address.' });
        return;
      }
      if (serviceability && !serviceability.serviceable) {
        setCheckoutError({
          code: 'AREA_UNSERVICEABLE',
          message: 'Selected PIN code is outside delivery coverage — switch to Store Pickup.',
        });
        return;
      }
    }
    if (cart?.requiresPrescription && !selectedRxId) {
      setCheckoutError({
        code: 'RX_REJECTED',
        message: 'Please upload or select a prescription for Schedule H medicines.',
      });
      return;
    }

    if (paymentMethod === PaymentMethod.RAZORPAY_TEST && rxApprovedAlready) {
      setPlacingOrder(true);
      try {
        const init = await apiFetch<RazorpayOrderInitDTO>('/api/payments/razorpay/create-order', {
          method: 'POST',
          body: JSON.stringify({
            amountPaise: grandTotal,
            method: selectedGatewaySubMethod,
          }),
        });
        setRazorpayOrder(init);
        setRazorpayModalOpen(true);
      } catch (err: unknown) {
        setCheckoutError({
          code: err instanceof ApiError ? err.code : 'PAYMENT_FAILED',
          message: err instanceof Error ? err.message : 'Unable to initiate payment gateway',
        });
      } finally {
        setPlacingOrder(false);
      }
      return;
    }

    submitOrderRequest();
  };

  const stepStatuses = [
    Boolean(user),
    fulfillmentType === FulfillmentType.STORE_PICKUP || Boolean(selectedAddressId),
    fulfillmentType === FulfillmentType.STORE_PICKUP || Boolean(serviceability?.serviceable),
    !cart?.requiresPrescription || Boolean(selectedRxId),
    items.length > 0,
    Boolean(paymentMethod),
    false,
  ];

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
        <div className="border-b border-[#E1E5EB] pb-4 space-y-3">
          <h1 className="text-2xl font-bold text-[#202630]">7-Step Pharmacy Checkout</h1>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {CHECKOUT_STEPS.map((label, idx) => (
              <div
                key={label}
                className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-semibold ${
                  stepStatuses[idx]
                    ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#16835D]'
                    : 'border-[#E1E5EB] bg-white text-[#526071]'
                }`}
              >
                {stepStatuses[idx] && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {checkoutError && (
          <ErrorStatePanel
            code={checkoutError.code}
            message={checkoutError.message}
            onRetry={() => setCheckoutError(null)}
            secondaryAction={
              checkoutError.code === 'PAYMENT_FAILED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPaymentMethod(PaymentMethod.CASH_ON_DELIVERY);
                    setCheckoutError(null);
                  }}
                >
                  Switch to Cash on Delivery
                </Button>
              ) : undefined
            }
          />
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-6">
            {/* Step 1: Account Confirmed */}
            <Card className="p-4 flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-[#202630]">1. Signed in as {user.fullName}</span>
                <span className="text-[#526071] ml-2">({user.email} · {user.phone || 'Phone on file'})</span>
              </div>
              <CheckCircle2 className="h-4 w-4 text-[#16835D]" />
            </Card>

            {/* Step 2 & 3: Address + Serviceability Check OR Store Pickup */}
            <Card className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold text-[#202630]">
                  2 &amp; 3. Delivery Address &amp; PIN Code Serviceability
                </h2>
                <button
                  type="button"
                  onClick={() => setShowNewAddr((v) => !v)}
                  className="text-xs font-medium text-[#D71920] hover:underline cursor-pointer"
                >
                  {showNewAddr ? 'Cancel' : '+ Add New Address'}
                </button>
              </div>

              {showNewAddr && (
                <CheckoutAddressForm
                  newAddr={newAddr}
                  setNewAddr={setNewAddr}
                  onSubmit={handleSaveAddress}
                />
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {addresses.map((addr) => (
                  <label
                    key={addr.id}
                    className={`block rounded-md border p-3.5 cursor-pointer ${
                      selectedAddressId === addr.id
                        ? 'border-[#D71920] bg-[#FFF5F5]'
                        : 'border-[#E1E5EB] bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="address"
                        checked={selectedAddressId === addr.id}
                        onChange={() => setSelectedAddressId(addr.id)}
                        className="accent-[#D71920]"
                      />
                      <span className="text-sm font-bold text-[#202630]">{addr.label}</span>
                      <span className="ml-auto text-[11px] font-mono text-[#526071]">{addr.postal_code}</span>
                    </div>
                    <div className="mt-1.5 pl-5 text-xs text-[#526071] space-y-0.5">
                      <div className="font-medium text-[#202630]">
                        {addr.recipient_name} · {addr.phone}
                      </div>
                      <div>
                        {[addr.flat_building, addr.society_name, addr.street].filter(Boolean).join(', ') || addr.line1}
                        {addr.landmark ? `, ${addr.landmark}` : ''}
                      </div>
                      <div>
                        {addr.city}, {addr.state} — {addr.postal_code}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {serviceability && fulfillmentType === FulfillmentType.DELIVERY && (
                <div
                  className={`rounded-md border p-3 text-xs flex items-start justify-between gap-3 ${
                    serviceability.serviceable
                      ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#16835D]'
                      : 'border-[#F5C2C7] bg-[#FFF5F5] text-[#B5121B]'
                  }`}
                >
                  <div>
                    <div className="font-semibold">
                      {serviceability.serviceable
                        ? `Delivery Serviceable for PIN ${serviceability.checkedPin}`
                        : `PIN ${serviceability.checkedPin} is outside local delivery zones`}
                    </div>
                    <div className="text-[#526071] mt-0.5">
                      {serviceability.serviceable
                        ? `${serviceability.areaName} · Estimated arrival ~${serviceability.estimatedMins} mins · Standard fee ${formatINRPaise(serviceability.deliveryFeePaise)}`
                        : 'Switch fulfillment to Store Pickup below to collect from Gaurav Avenue, Mira Road East.'}
                    </div>
                  </div>
                  {!serviceability.serviceable && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setFulfillmentType(FulfillmentType.STORE_PICKUP)}
                    >
                      Use Store Pickup
                    </Button>
                  )}
                </div>
              )}
            </Card>

            {/* Step 4: Prescription */}
            {cart?.requiresPrescription && (
              <Card className="p-5 space-y-4 border-[#F5C2C7]">
                <h2 className="text-base font-bold text-[#B5121B]">
                  4. Required Prescription (Schedule H / H1)
                </h2>
                <p className="text-xs text-[#526071]">
                  Select an existing prescription submission or upload a new image/PDF. If not yet approved, your order enters Pending Pharmacist Verification and online payment unlocks upon review.
                </p>
                {prescriptions.length > 0 && (
                  <div className="space-y-2">
                    {prescriptions.map((rx) => (
                      <label key={rx.id} className="flex items-center gap-2.5 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="rx"
                          checked={selectedRxId === rx.id}
                          onChange={() => setSelectedRxId(rx.id)}
                          className="accent-[#16835D]"
                        />
                        <span className="font-medium">{rx.patient_name}</span>
                        <span
                          className={`text-xs font-semibold ${
                            rx.status === 'APPROVED' ? 'text-[#16835D]' : 'text-[#B45309]'
                          }`}
                        >
                          ({rx.status.replace(/_/g, ' ')})
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E1E5EB]">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setRxFile(e.target.files?.[0] || null)}
                    className="text-xs"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!rxFile || uploadingRx}
                    onClick={handleQuickRxUpload}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {uploadingRx ? 'Uploading...' : 'Attach Prescription'}
                  </Button>
                </div>
              </Card>
            )}

            {/* Step 5: Review Items */}
            <Card className="p-5 space-y-3">
              <h2 className="text-base font-bold text-[#202630]">
                5. Review Medicines &amp; Tax-Inclusive Charges
              </h2>
              <div className="divide-y divide-[#E1E5EB] text-xs">
                {items.map((it) => (
                  <div key={it.id} className="py-2 flex justify-between gap-2">
                    <div>
                      <span className="font-semibold text-[#202630]">{it.name}</span>
                      <span className="text-[#526071] ml-1.5">
                        ({it.packSize}) × {it.quantity}
                      </span>
                    </div>
                    <span className="font-bold tabular-nums">
                      {formatINRPaise(it.salePricePaise * it.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Step 6: Fulfillment & Payment Method */}
            <Card className="p-5 space-y-4">
              <h2 className="text-base font-bold text-[#202630]">
                6. Select Fulfillment &amp; Payment Method
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`flex items-start gap-2.5 rounded-md border p-3.5 cursor-pointer ${
                    fulfillmentType === FulfillmentType.DELIVERY
                      ? 'border-[#D71920] bg-[#FFF5F5]'
                      : 'border-[#E1E5EB]'
                  }`}
                >
                  <input
                    type="radio"
                    name="fulfillment"
                    checked={fulfillmentType === FulfillmentType.DELIVERY}
                    onChange={() => setFulfillmentType(FulfillmentType.DELIVERY)}
                    className="mt-1 accent-[#D71920]"
                  />
                  <div>
                    <div className="text-sm font-bold text-[#202630] flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-[#D71920]" />
                      Home Delivery
                    </div>
                    <div className="text-xs text-[#526071]">
                      Delivered to your Mira Road / Bhayandar address
                    </div>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-2.5 rounded-md border p-3.5 cursor-pointer ${
                    fulfillmentType === FulfillmentType.STORE_PICKUP
                      ? 'border-[#16835D] bg-[#ECFDF5]'
                      : 'border-[#E1E5EB]'
                  }`}
                >
                  <input
                    type="radio"
                    name="fulfillment"
                    checked={fulfillmentType === FulfillmentType.STORE_PICKUP}
                    onChange={() => setFulfillmentType(FulfillmentType.STORE_PICKUP)}
                    className="mt-1 accent-[#16835D]"
                  />
                  <div>
                    <div className="text-sm font-bold text-[#202630] flex items-center gap-1.5">
                      <Store className="h-4 w-4 text-[#16835D]" />
                      Store Pickup (Free)
                    </div>
                    <div className="text-xs text-[#526071]">
                      Collect at Gaurav Avenue, Hatkesh Road (8 AM – 11 PM)
                    </div>
                  </div>
                </label>
              </div>

              {!rxApprovedAlready && (
                <div className="flex items-start gap-2 rounded-md border border-[#F59E0B] bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Because your prescription is pending pharmacist verification, this order will be submitted for review first. Online Razorpay Test payment unlocks on your tracking page immediately after pharmacist approval.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  {
                    id: PaymentMethod.RAZORPAY_TEST,
                    label: 'Online Pay (Razorpay Test Mode: UPI / Card / NetBanking)',
                  },
                  { id: PaymentMethod.CASH_ON_DELIVERY, label: 'Cash on Delivery / Pay at Counter' },
                ].map((m) => (
                  <label
                    key={m.id}
                    className={`flex items-center gap-2.5 rounded-md border p-3.5 text-sm font-medium cursor-pointer ${
                      paymentMethod === m.id ? 'border-[#D71920] bg-[#FFF5F5]' : 'border-[#E1E5EB]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      checked={paymentMethod === m.id}
                      onChange={() => setPaymentMethod(m.id)}
                      className="accent-[#D71920]"
                    />
                    <span>{m.label}</span>
                  </label>
                ))}
              </div>

              <div>
                <Label>Delivery / Pickup Instructions (Optional)</Label>
                <Textarea
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="Wing / gate instructions, call on arrival, or pickup time"
                />
              </div>
            </Card>
          </div>

          {/* Step 7: Summary & Confirm */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="p-5 space-y-4 sticky top-24">
              <h2 className="text-base font-bold text-[#202630] border-b border-[#E1E5EB] pb-3">
                7. Confirm &amp; Place Order
              </h2>

              <div className="flex gap-2">
                <Input
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  placeholder="Coupon (e.g. LEELA10)"
                />
                <Button type="button" variant="outline" onClick={handleApplyCoupon}>
                  Apply
                </Button>
              </div>
              {appliedCoupon && (
                <p className="text-xs font-medium text-[#16835D]">
                  Applied {appliedCoupon.code}: {appliedCoupon.description}
                </p>
              )}

              <div className="space-y-2 border-t border-[#E1E5EB] pt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#526071]">Items Subtotal (GST incl.)</span>
                  <span className="tabular-nums">{formatINRPaise(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-[#16835D]">
                    <span>Coupon Discount</span>
                    <span className="tabular-nums">−{formatINRPaise(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#526071]">
                    {fulfillmentType === FulfillmentType.STORE_PICKUP ? 'Store Pickup' : 'Delivery Fee'}
                  </span>
                  <span className="tabular-nums">
                    {deliveryFee === 0 ? 'Free' : formatINRPaise(deliveryFee)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-[#E1E5EB] pt-3 text-base font-bold">
                  <span>Payable Total</span>
                  <span className="tabular-nums">{formatINRPaise(grandTotal)}</span>
                </div>
              </div>

              <Button
                className="w-full"
                size="lg"
                disabled={placingOrder}
                onClick={handlePlaceOrderClick}
              >
                {placingOrder
                  ? 'Submitting...'
                  : !rxApprovedAlready
                    ? `Submit for Pharmacist Review (${formatINRPaise(grandTotal)})`
                    : paymentMethod === PaymentMethod.RAZORPAY_TEST
                      ? `Pay & Place Order (${formatINRPaise(grandTotal)})`
                      : `Confirm Order (${formatINRPaise(grandTotal)})`}
              </Button>
            </Card>
          </div>
        </div>
      </div>

      {/* Razorpay Test Mode Interactive Gateway Dialog */}
      {razorpayModalOpen && razorpayOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E1E5EB] pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-[#16835D]" />
                <div>
                  <h3 className="text-base font-bold text-[#202630]">Razorpay Test Checkout</h3>
                  <p className="text-[11px] text-[#526071]">
                    Shree Leela Medical &amp; General Stores · {razorpayOrder.mode.toUpperCase()} MODE
                  </p>
                </div>
              </div>
              <span className="rounded bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-bold text-[#92400E]">
                HMAC VERIFIED
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              {(['UPI', 'CARD', 'NETBANKING'] as const).map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setSelectedGatewaySubMethod(sub)}
                  className={`rounded border px-2 py-1.5 font-semibold cursor-pointer ${
                    selectedGatewaySubMethod === sub
                      ? 'border-[#D71920] bg-[#FFF5F5] text-[#D71920]'
                      : 'border-[#E1E5EB] bg-white text-[#526071]'
                  }`}
                >
                  {sub}
                </button>
              ))}
            </div>

            <div className="rounded bg-[#F5F7FA] p-4 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[#526071]">Gateway Order ID</span>
                <span className="font-mono font-semibold text-[#202630]">{razorpayOrder.gatewayOrderId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#526071]">Customer</span>
                <span className="font-semibold">{user.fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#526071]">Payable Amount</span>
                <span className="text-base font-bold text-[#202630] tabular-nums">
                  {formatINRPaise(razorpayOrder.amountPaise)}
                </span>
              </div>
            </div>

            <p className="text-xs text-[#526071]">
              Authorize simulated {selectedGatewaySubMethod} payment (server HMAC SHA-256 verification) or test failure recovery without charging real money.
            </p>
            <div className="flex flex-wrap gap-2 justify-between pt-1">
              <Button variant="outline" size="sm" disabled={placingOrder} onClick={handleSimulateRazorpayFailure}>
                Simulate Failure
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setRazorpayModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={placingOrder}
                  onClick={handleAuthorizeRazorpayTest}
                >
                  {placingOrder ? 'Verifying...' : 'Authorize Test Payment'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </StorefrontLayout>
  );
}

interface NewAddrState {
  label: string;
  recipientName: string;
  phone: string;
  flatBuilding: string;
  societyName: string;
  street: string;
  landmark: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: string;
  longitude: string;
}

function CheckoutAddressForm({
  newAddr,
  setNewAddr,
  onSubmit,
}: {
  newAddr: NewAddrState;
  setNewAddr: React.Dispatch<React.SetStateAction<NewAddrState>>;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const { showToast } = useApp();
  const [mapsEnabled, setMapsEnabled] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ placeId: string; description: string; primaryText: string; secondaryText?: string }>>([]);
  const [sessionToken] = useState(() => `slm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    apiFetch<{ serverApiConfigured: boolean }>('/api/maps/config')
      .then((c) => setMapsEnabled(c.serverApiConfigured))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!mapsEnabled || searchQuery.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<{ available: boolean; suggestions: typeof suggestions }>(
        `/api/maps/autocomplete?input=${encodeURIComponent(searchQuery)}&sessionToken=${encodeURIComponent(sessionToken)}`
      )
        .then((res) => setSuggestions(res.suggestions || []))
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, mapsEnabled, sessionToken]);

  const handleSelectSuggestion = async (s: { placeId: string; description: string; primaryText: string }) => {
    setSuggestions([]);
    setSearchQuery(s.description);
    try {
      const details = await apiFetch<{
        available: boolean;
        latitude?: number;
        longitude?: number;
        postalCode?: string;
      }>(`/api/maps/place-details?placeId=${encodeURIComponent(s.placeId)}&sessionToken=${encodeURIComponent(sessionToken)}`);
      if (details.available && details.latitude && details.longitude) {
        setNewAddr((prev) => ({
          ...prev,
          street: prev.street || s.primaryText,
          postalCode: details.postalCode || prev.postalCode,
          latitude: details.latitude!.toFixed(6),
          longitude: details.longitude!.toFixed(6),
        }));
        showToast('Coordinates resolved from selected place');
      }
    } catch {
      // Keep manual input intact
    }
  };

  const handleGeocodeManual = async () => {
    const query = [newAddr.societyName, newAddr.street, newAddr.city, newAddr.postalCode].filter(Boolean).join(', ');
    if (query.length < 4) return;
    try {
      const res = await apiFetch<{ available: boolean; latitude?: number; longitude?: number; reason?: string }>(
        '/api/maps/geocode',
        { method: 'POST', body: JSON.stringify({ address: query }) }
      );
      if (res.available && res.latitude && res.longitude) {
        setNewAddr((prev) => ({
          ...prev,
          latitude: res.latitude!.toFixed(6),
          longitude: res.longitude!.toFixed(6),
        }));
        showToast('Coordinates updated from address');
      } else {
        showToast(res.reason || 'Geocoding unavailable; enter pin coordinates manually', 'error');
      }
    } catch {
      showToast('Unable to geocode address', 'error');
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 border rounded-md border-[#E1E5EB] bg-[#F5F7FA] p-4"
    >
      {mapsEnabled && (
        <div className="sm:col-span-2 relative">
          <Label>Search Building / Locality (Google Places Autocomplete)</Label>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Start typing society or road in Mira Road East..."
          />
          {suggestions.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-[#E1E5EB] bg-white shadow-md divide-y divide-[#E1E5EB]">
              {suggestions.map((s) => (
                <button
                  key={s.placeId}
                  type="button"
                  onClick={() => handleSelectSuggestion(s)}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-[#F5F7FA] cursor-pointer"
                >
                  <div className="font-semibold text-[#202630]">{s.primaryText}</div>
                  {s.secondaryText && <div className="text-[#526071]">{s.secondaryText}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <Label>Label (Home / Office)</Label>
        <Input
          required
          value={newAddr.label}
          onChange={(e) => setNewAddr({ ...newAddr, label: e.target.value })}
        />
      </div>
      <div>
        <Label>Full Name *</Label>
        <Input
          required
          value={newAddr.recipientName}
          onChange={(e) => setNewAddr({ ...newAddr, recipientName: e.target.value })}
        />
      </div>
      <div>
        <Label>Mobile Number *</Label>
        <Input
          required
          value={newAddr.phone}
          onChange={(e) => setNewAddr({ ...newAddr, phone: e.target.value })}
        />
      </div>
      <div>
        <Label>PIN Code *</Label>
        <Input
          required
          maxLength={6}
          value={newAddr.postalCode}
          onChange={(e) => setNewAddr({ ...newAddr, postalCode: e.target.value })}
        />
      </div>
      <div>
        <Label>Flat / Building *</Label>
        <Input
          required
          value={newAddr.flatBuilding}
          onChange={(e) => setNewAddr({ ...newAddr, flatBuilding: e.target.value })}
          placeholder="Flat 404, Wing B"
        />
      </div>
      <div>
        <Label>Society / Complex Name *</Label>
        <Input
          required
          value={newAddr.societyName}
          onChange={(e) => setNewAddr({ ...newAddr, societyName: e.target.value })}
          placeholder="Gaurav Avenue"
        />
      </div>
      <div>
        <Label>Street / Road *</Label>
        <Input
          required
          value={newAddr.street}
          onChange={(e) => setNewAddr({ ...newAddr, street: e.target.value })}
          placeholder="Hatkesh Road"
        />
      </div>
      <div>
        <Label>Landmark (Optional)</Label>
        <Input
          value={newAddr.landmark}
          onChange={(e) => setNewAddr({ ...newAddr, landmark: e.target.value })}
          placeholder="Near GCC Club"
        />
      </div>
      <div>
        <Label>City *</Label>
        <Input
          required
          value={newAddr.city}
          onChange={(e) => setNewAddr({ ...newAddr, city: e.target.value })}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label>Map Pin Coordinates (Lat / Lng)</Label>
          {mapsEnabled && (
            <button
              type="button"
              onClick={handleGeocodeManual}
              className="text-[11px] font-medium text-[#16835D] hover:underline cursor-pointer"
            >
              Auto-geocode
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={newAddr.latitude}
            onChange={(e) => setNewAddr({ ...newAddr, latitude: e.target.value })}
            placeholder="19.2845"
          />
          <Input
            value={newAddr.longitude}
            onChange={(e) => setNewAddr({ ...newAddr, longitude: e.target.value })}
            placeholder="72.8745"
          />
        </div>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm">Save Address</Button>
      </div>
    </form>
  );
}

