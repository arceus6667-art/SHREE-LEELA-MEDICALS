import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  LogOut,
  MapPin,
  Package,
  RefreshCw,
  FileText,
  Bookmark,
  Bell,
  HelpCircle,
  Printer,
  Trash2,
  X,
} from 'lucide-react';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import {
  formatIndianDateTime,
  formatINRPaise,
  ORDER_STATUS_LABELS,
  type MedicineDTO,
  type NotificationPreferencesDTO,
  type OrderStatus,
  type PublicStoreInfo,
} from '../../shared/types.ts';

interface CustomerOrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  prescription_status: string;
  fulfillment_type?: string;
  total_paise: number;
  payment_method: string;
  payment_status: string;
  created_at: string;
  address_line1: string | null;
  address_city: string | null;
  invoice_number: string | null;
  items: Array<{ id: string; medicine_name: string; quantity: number; line_total_paise: number }>;
}

interface DashboardPayload {
  addresses: Array<{
    id: string;
    label: string;
    recipient_name: string;
    phone: string;
    line1: string;
    landmark: string | null;
    city: string;
    state: string;
    postal_code: string;
  }>;
  orders: CustomerOrderRow[];
  prescriptions: Array<{
    id: string;
    patient_name: string;
    doctor_name: string | null;
    status: string;
    latest_remarks: string | null;
    quoted_amount_paise: number | null;
    pharmacist_quotation_notes: string | null;
    quotation_accepted: number;
    file_url: string;
    signed_file_url?: string;
    created_at: string;
  }>;
  savedProducts: MedicineDTO[];
  refundRequests: Array<{
    id: string;
    order_number: string;
    reason: string;
    amount_paise: number;
    status: string;
    admin_note: string | null;
    created_at: string;
  }>;
  supportTickets: Array<{
    id: string;
    subject: string;
    message: string;
    status: string;
    created_at: string;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    message: string;
    is_read: number;
    created_at: string;
  }>;
}

interface InvoiceModalData {
  store: PublicStoreInfo;
  order: {
    invoice_number: string;
    issued_at: string;
    order_number: string;
    full_name: string;
    phone: string;
    line1: string | null;
    city: string | null;
    postal_code: string | null;
    subtotal_paise: number;
    tax_paise: number;
    discount_paise: number;
    delivery_fee_paise: number;
    total_paise: number;
    payment_method: string;
    payment_status: string;
  };
  items: Array<{
    id: string;
    medicine_name: string;
    pack_size: string;
    quantity: number;
    unit_price_paise: number;
    tax_paise: number;
    line_total_paise: number;
  }>;
}

type AccountTab = 'orders' | 'prescriptions' | 'saved' | 'addresses' | 'support' | 'notifications' | 'profile';

export function AccountPage() {
  const { user, refreshUser, logout, reorderOrder, addToCart, showToast } = useApp();
  const navigate = useNavigate();

  const [tab, setTab] = useState<AccountTab>('orders');
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [verifyToken, setVerifyToken] = useState(() => sessionStorage.getItem('slm_verify_token') || '');

  const [invoiceData, setInvoiceData] = useState<InvoiceModalData | null>(null);
  const [refundOrder, setRefundOrder] = useState<CustomerOrderRow | null>(null);
  const [refundReason, setRefundReason] = useState('');

  const [addrForm, setAddrForm] = useState({
    label: 'Home',
    recipientName: '',
    phone: '',
    flatBuilding: '',
    societyName: '',
    street: '',
    landmark: '',
    city: 'Mira Road East',
    postalCode: '401107',
  });

  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferencesDTO>({
    inApp: true,
    email: true,
    sms: false,
    whatsapp: false,
    marketingConsent: false,
  });

  const loadDashboard = () => {
    if (!user) return;
    apiFetch<DashboardPayload>('/api/account/dashboard')
      .then(setDashboard)
      .catch(console.error);
    apiFetch<{ preferences: NotificationPreferencesDTO }>('/api/account/notification-preferences')
      .then((d) => setNotifPrefs(d.preferences))
      .catch(() => {});
  };

  useEffect(() => {
    if (user) {
      setFullName(user.fullName);
      setPhone(user.phone || '');
      setAddrForm((f) => ({ ...f, recipientName: f.recipientName || user.fullName, phone: f.phone || user.phone || '' }));
      loadDashboard();
    }
  }, [user]);

  if (!user) {
    return (
      <StorefrontLayout>
        <div className="mx-auto max-w-md px-4 py-12">
          <Card className="p-8 text-center space-y-4">
            <h1 className="text-xl font-bold">Sign in to view Your Pharmacy Account</h1>
            <Link to="/login?redirect=/account">
              <Button>Customer Sign In</Button>
            </Link>
          </Card>
        </div>
      </StorefrontLayout>
    );
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ fullName, phone }),
      });
      await refreshUser();
      showToast('Account settings updated');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleRequestVerification = async () => {
    const res = await apiFetch<{ verificationPreviewToken: string }>('/api/auth/resend-verification', {
      method: 'POST',
    });
    setVerifyToken(res.verificationPreviewToken);
    showToast('Verification token generated');
  };

  const handleVerifyEmail = async () => {
    try {
      await apiFetch('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verifyToken }),
      });
      sessionStorage.removeItem('slm_verify_token');
      await refreshUser();
      showToast('Email verified');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Invalid token', 'error');
    }
  };

  const handleOpenInvoice = async (orderId: string) => {
    try {
      const data = await apiFetch<InvoiceModalData>(`/api/invoices/${orderId}`);
      setInvoiceData(data);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to load invoice', 'error');
    }
  };

  const handleSubmitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundOrder) return;
    try {
      await apiFetch('/api/refund-requests', {
        method: 'POST',
        body: JSON.stringify({ orderId: refundOrder.id, reason: refundReason }),
      });
      showToast('Refund request submitted for admin review');
      setRefundOrder(null);
      setRefundReason('');
      loadDashboard();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Refund request failed', 'error');
    }
  };

  const handleAcceptQuotation = async (rxId: string) => {
    try {
      await apiFetch(`/api/prescriptions/${rxId}/accept-quotation`, { method: 'POST' });
      showToast('Quotation accepted');
      loadDashboard();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to accept quotation', 'error');
    }
  };

  const handleRemoveSaved = async (medId: string) => {
    await apiFetch(`/api/saved-items/${medId}`, { method: 'DELETE' });
    showToast('Removed from saved products');
    loadDashboard();
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/addresses', { method: 'POST', body: JSON.stringify(addrForm) });
      showToast('Address added');
      setAddrForm({ ...addrForm, flatBuilding: '', societyName: '', street: '', landmark: '' });
      loadDashboard();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to add address', 'error');
    }
  };

  const handleDeleteAddress = async (id: string) => {
    await apiFetch(`/api/addresses/${id}`, { method: 'DELETE' });
    showToast('Address deleted');
    loadDashboard();
  };

  const handleMarkNotificationsRead = async () => {
    await apiFetch('/api/notifications/mark-read', { method: 'POST' });
    loadDashboard();
  };

  const unreadCount = dashboard?.notifications.filter((n) => !n.is_read).length || 0;

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E1E5EB] pb-4">
          <div>
            <h1 className="text-2xl font-bold text-[#202630]">My Pharmacy Account</h1>
            <p className="text-xs text-[#526071]">
              {user.fullName} · {user.email}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await logout();
              navigate('/');
            }}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>

        {/* Account Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-[#E1E5EB] pb-3">
          {[
            { id: 'orders' as const, label: `Orders (${dashboard?.orders.length || 0})`, icon: Package },
            { id: 'prescriptions' as const, label: `Prescriptions (${dashboard?.prescriptions.length || 0})`, icon: FileText },
            { id: 'saved' as const, label: `Saved Products (${dashboard?.savedProducts.length || 0})`, icon: Bookmark },
            { id: 'addresses' as const, label: `Addresses (${dashboard?.addresses.length || 0})`, icon: MapPin },
            { id: 'support' as const, label: 'Refunds & Support', icon: HelpCircle },
            { id: 'notifications' as const, label: `Notifications${unreadCount ? ` (${unreadCount})` : ''}`, icon: Bell },
            { id: 'profile' as const, label: 'Profile & Email', icon: CheckCircle2 },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                tab === t.id
                  ? 'border-[#D71920] bg-[#D71920] text-white'
                  : 'border-[#E1E5EB] bg-white text-[#202630] hover:bg-[#F5F7FA]'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Orders Tab */}
        {tab === 'orders' && (
          <div className="space-y-4">
            {!dashboard || dashboard.orders.length === 0 ? (
              <Card className="p-8 text-center space-y-3">
                <p className="text-sm text-[#526071]">You have not placed any orders yet.</p>
                <Link to="/pharmacy"><Button>Browse Medicines</Button></Link>
              </Card>
            ) : (
              dashboard.orders.map((ord) => (
                <Card key={ord.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E1E5EB] pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-[#202630]">{ord.order_number}</span>
                        <span className="text-xs text-[#526071]">· {formatIndianDateTime(ord.created_at)}</span>
                        {ord.fulfillment_type === 'STORE_PICKUP' && (
                          <span className="rounded bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-bold text-[#16835D]">
                            STORE PICKUP
                          </span>
                        )}
                      </div>
                      {ord.address_line1 && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-[#526071]">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>{ord.address_line1}, {ord.address_city}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-[#16835D]">
                        {ORDER_STATUS_LABELS[ord.status] || ord.status}
                      </div>
                      <div className="text-xs text-[#526071] tabular-nums">
                        Total: {formatINRPaise(ord.total_paise)} · {ord.payment_method} ({ord.payment_status})
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1 text-xs text-[#202630]">
                    {ord.items.map((it) => (
                      <div key={it.id} className="flex justify-between">
                        <span>{it.medicine_name} × {it.quantity}</span>
                        <span className="tabular-nums font-medium">{formatINRPaise(it.line_total_paise)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E1E5EB] text-xs">
                    <span className="font-mono text-[#526071]">
                      Invoice: {ord.invoice_number || 'Pending'} · Rx: {ord.prescription_status}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await reorderOrder(ord.id);
                          navigate('/cart');
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reorder
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleOpenInvoice(ord.id)}>
                        <FileText className="h-3.5 w-3.5" />
                        GST Invoice
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRefundOrder(ord)}>
                        Request Refund
                      </Button>
                      <Link to={`/track/${ord.order_number}`}>
                        <Button size="sm">Track Order →</Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {/* Prescriptions Tab */}
        {tab === 'prescriptions' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Link to="/upload-prescription"><Button size="sm">Upload New Prescription</Button></Link>
            </div>
            {(dashboard?.prescriptions || []).map((rx) => (
              <Card key={rx.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-bold text-[#202630]">{rx.patient_name}</div>
                    <div className="text-xs text-[#526071]">
                      {rx.doctor_name || 'Doctor not specified'} · {formatIndianDateTime(rx.created_at)}
                    </div>
                  </div>
                  <span className="text-xs font-bold text-[#16835D]">{rx.status}</span>
                </div>
                {rx.latest_remarks && (
                  <p className="rounded bg-[#F5F7FA] p-2.5 text-xs text-[#202630]">
                    Pharmacist: {rx.latest_remarks}
                  </p>
                )}
                {rx.quoted_amount_paise && (
                  <div className="flex items-center justify-between rounded bg-[#ECFDF5] p-2.5 text-xs">
                    <span>
                      Quotation: <strong>{formatINRPaise(rx.quoted_amount_paise)}</strong>
                      {rx.pharmacist_quotation_notes ? ` — ${rx.pharmacist_quotation_notes}` : ''}
                    </span>
                    {rx.quotation_accepted ? (
                      <span className="font-semibold text-[#16835D]">Accepted</span>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => handleAcceptQuotation(rx.id)}>
                        Accept Quotation
                      </Button>
                    )}
                  </div>
                )}
                <a
                  href={rx.signed_file_url || rx.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs font-medium text-[#D71920] hover:underline"
                >
                  View Prescription Document →
                </a>
              </Card>
            ))}
          </div>
        )}

        {/* Saved Products (Wishlist) Tab */}
        {tab === 'saved' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(dashboard?.savedProducts || []).length === 0 ? (
              <Card className="p-6 text-sm text-[#526071] sm:col-span-3">
                No saved products yet. Click &quot;Save to Wishlist&quot; on any medicine detail page.
              </Card>
            ) : (
              dashboard!.savedProducts.map((m) => (
                <Card key={m.id} className="p-4 space-y-2">
                  <Link to={`/medicine/${m.slug}`} className="text-sm font-bold text-[#202630] hover:text-[#D71920] block">
                    {m.name}
                  </Link>
                  <div className="text-xs text-[#526071]">{m.manufacturerName} · {m.packSize}</div>
                  <div className="text-sm font-bold tabular-nums">{formatINRPaise(m.salePricePaise)}</div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" disabled={!m.canPurchase} onClick={() => addToCart(m.id, 1)}>
                      Add to Cart
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleRemoveSaved(m.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </Card>
              ))
            )}
          </div>
        )}

        {/* Addresses Tab */}
        {tab === 'addresses' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <Card className="lg:col-span-5 p-5 h-fit">
              <h2 className="mb-3 text-base font-bold text-[#202630]">Add Saved Address</h2>
              <form onSubmit={handleAddAddress} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Label</Label><Input required value={addrForm.label} onChange={(e) => setAddrForm({ ...addrForm, label: e.target.value })} /></div>
                  <div><Label>PIN Code</Label><Input required maxLength={6} value={addrForm.postalCode} onChange={(e) => setAddrForm({ ...addrForm, postalCode: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Full Name</Label><Input required value={addrForm.recipientName} onChange={(e) => setAddrForm({ ...addrForm, recipientName: e.target.value })} /></div>
                  <div><Label>Mobile</Label><Input required value={addrForm.phone} onChange={(e) => setAddrForm({ ...addrForm, phone: e.target.value })} /></div>
                </div>
                <div><Label>Flat / Building</Label><Input required value={addrForm.flatBuilding} onChange={(e) => setAddrForm({ ...addrForm, flatBuilding: e.target.value })} /></div>
                <div><Label>Society Name</Label><Input required value={addrForm.societyName} onChange={(e) => setAddrForm({ ...addrForm, societyName: e.target.value })} /></div>
                <div><Label>Street &amp; Landmark</Label><Input required value={addrForm.street} onChange={(e) => setAddrForm({ ...addrForm, street: e.target.value })} /></div>
                <Button type="submit" className="w-full">Save Address</Button>
              </form>
            </Card>
            <div className="lg:col-span-7 space-y-3">
              {(dashboard?.addresses || []).map((a) => (
                <Card key={a.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="text-xs text-[#526071] space-y-0.5">
                    <div className="text-sm font-bold text-[#202630]">{a.label} — {a.recipient_name}</div>
                    <div>{a.line1}{a.landmark ? `, ${a.landmark}` : ''}</div>
                    <div>{a.city}, {a.state} — {a.postal_code} · {a.phone}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleDeleteAddress(a.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Refunds & Support Tab */}
        {tab === 'support' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5 space-y-3">
              <h2 className="text-base font-bold text-[#202630]">Refund Requests</h2>
              {(dashboard?.refundRequests || []).length === 0 ? (
                <p className="text-xs text-[#526071]">No refund requests submitted.</p>
              ) : (
                dashboard!.refundRequests.map((r) => (
                  <div key={r.id} className="border-b border-[#E1E5EB] pb-2.5 text-xs space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span className="font-mono">{r.order_number}</span>
                      <span className="text-[#16835D]">{r.status} · {formatINRPaise(r.amount_paise)}</span>
                    </div>
                    <p className="text-[#526071]">{r.reason}</p>
                    {r.admin_note && <p className="text-[#202630]">Store note: {r.admin_note}</p>}
                  </div>
                ))
              )}
            </Card>
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#202630]">Support Tickets &amp; Pharmacist Queries</h2>
                <Link to="/contact" className="text-xs font-semibold text-[#D71920] hover:underline">
                  New Ticket →
                </Link>
              </div>
              {(dashboard?.supportTickets || []).length === 0 ? (
                <p className="text-xs text-[#526071]">No support tickets raised.</p>
              ) : (
                dashboard!.supportTickets.map((t) => (
                  <div key={t.id} className="border-b border-[#E1E5EB] pb-2.5 text-xs space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span>{t.subject}</span>
                      <span className="text-[#16835D]">{t.status}</span>
                    </div>
                    <p className="text-[#526071]">{t.message}</p>
                  </div>
                ))
              )}
            </Card>
          </div>
        )}

        {/* Notifications Tab */}
        {tab === 'notifications' && (
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-[#E1E5EB] pb-3">
              <h2 className="text-base font-bold text-[#202630]">Account Notifications</h2>
              <Button size="sm" variant="outline" onClick={handleMarkNotificationsRead}>
                Mark All Read
              </Button>
            </div>
            {(dashboard?.notifications || []).map((n) => (
              <div key={n.id} className={`rounded border p-3 text-xs ${n.is_read ? 'border-[#E1E5EB] bg-white' : 'border-[#F5C2C7] bg-[#FFF5F5]'}`}>
                <div className="flex justify-between font-semibold text-[#202630]">
                  <span>{n.title}</span>
                  <span className="text-[#526071]">{formatIndianDateTime(n.created_at)}</span>
                </div>
                <p className="mt-1 text-[#526071]">{n.message}</p>
              </div>
            ))}
          </Card>
        )}

        {/* Profile Tab */}
        {tab === 'profile' && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card className="p-6 space-y-4">
              <h2 className="text-base font-bold text-[#202630]">Profile Information</h2>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <Label>Full Name</Label>
                  <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div>
                  <Label>Phone Number</Label>
                  <Input required value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <Button type="submit">Save Changes</Button>
              </form>
            </Card>

            <Card className="p-6 space-y-4">
              <h2 className="text-base font-bold text-[#202630]">Email Verification</h2>
              {user.isEmailVerified ? (
                <div className="flex items-center gap-2 text-sm font-medium text-[#16835D]">
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Your email address ({user.email}) is verified.</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-[#526071]">
                    Verify your email address to receive order and prescription updates.
                  </p>
                  <Button variant="outline" size="sm" onClick={handleRequestVerification}>
                    Generate Verification Token
                  </Button>
                  <div className="flex gap-2">
                    <Input
                      value={verifyToken}
                      onChange={(e) => setVerifyToken(e.target.value)}
                      placeholder="Paste verification token"
                    />
                    <Button size="sm" onClick={handleVerifyEmail}>
                      Verify
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            <Card className="p-6 space-y-4 md:col-span-2">
              <div className="flex items-center justify-between border-b border-[#E1E5EB] pb-2">
                <div>
                  <h2 className="text-base font-bold text-[#202630]">Notification Channels &amp; Consent Preferences</h2>
                  <p className="text-xs text-[#526071]">
                    Control how order updates, pharmacist clarification requests, and delivery OTPs reach you.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                {[
                  { key: 'inApp' as const, label: 'In-App Alerts' },
                  { key: 'email' as const, label: 'Email Transactional' },
                  { key: 'sms' as const, label: 'SMS Updates & OTP' },
                  { key: 'whatsapp' as const, label: 'WhatsApp Opt-In' },
                  { key: 'marketingConsent' as const, label: 'Refill / Store Reminders' },
                ].map((ch) => (
                  <label
                    key={ch.key}
                    className="flex items-center gap-2 rounded border border-[#E1E5EB] p-3 cursor-pointer hover:bg-[#F5F7FA]"
                  >
                    <input
                      type="checkbox"
                      checked={notifPrefs[ch.key]}
                      onChange={async (e) => {
                        const next = { ...notifPrefs, [ch.key]: e.target.checked };
                        setNotifPrefs(next);
                        try {
                          await apiFetch('/api/account/notification-preferences', {
                            method: 'PATCH',
                            body: JSON.stringify(next),
                          });
                          showToast('Notification preferences updated');
                        } catch {
                          showToast('Unable to update preferences', 'error');
                        }
                      }}
                    />
                    <span className="font-medium text-[#202630]">{ch.label}</span>
                  </label>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Digital GST Invoice Modal */}
      {invoiceData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <Card className="w-full max-w-2xl p-6 space-y-4 bg-white">
            <div className="flex items-start justify-between border-b border-[#E1E5EB] pb-3">
              <div>
                <div className="text-xs font-bold text-[#D71920]">TAX INVOICE (GST)</div>
                <h3 className="text-lg font-bold text-[#202630]">{invoiceData.store.name}</h3>
                <p className="text-xs text-[#526071]">
                  {invoiceData.store.addressLine1}, {invoiceData.store.city} · GSTIN: {invoiceData.store.gstin || 'DEMO-GSTIN'} · DL: {invoiceData.store.drugLicenseNumber}
                </p>
              </div>
              <button type="button" onClick={() => setInvoiceData(null)} className="p-1 text-[#526071] cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="font-semibold text-[#202630]">Billed To: {invoiceData.order.full_name}</div>
                <div className="text-[#526071]">{invoiceData.order.phone}</div>
                {invoiceData.order.line1 && (
                  <div className="text-[#526071]">
                    {invoiceData.order.line1}, {invoiceData.order.city} — {invoiceData.order.postal_code}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="font-mono font-bold">{invoiceData.order.invoice_number}</div>
                <div className="text-[#526071]">Order: {invoiceData.order.order_number}</div>
                <div className="text-[#526071]">Issued: {formatIndianDateTime(invoiceData.order.issued_at)}</div>
              </div>
            </div>
            <table className="w-full text-xs border-t border-b border-[#E1E5EB]">
              <thead>
                <tr className="text-left text-[#526071] border-b border-[#E1E5EB]">
                  <th className="py-2">Medicine</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Rate</th>
                  <th className="py-2 text-right">GST incl.</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EB]">
                {invoiceData.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2">{it.medicine_name} ({it.pack_size})</td>
                    <td className="py-2 text-right tabular-nums">{it.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{formatINRPaise(it.unit_price_paise)}</td>
                    <td className="py-2 text-right tabular-nums">{formatINRPaise(it.tax_paise)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{formatINRPaise(it.line_total_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs space-y-1 text-right">
              <div>Subtotal: <span className="font-semibold tabular-nums">{formatINRPaise(invoiceData.order.subtotal_paise)}</span></div>
              <div>Total GST Component: <span className="tabular-nums">{formatINRPaise(invoiceData.order.tax_paise)}</span></div>
              <div>Discount: <span className="tabular-nums">−{formatINRPaise(invoiceData.order.discount_paise)}</span></div>
              <div>Delivery Fee: <span className="tabular-nums">{formatINRPaise(invoiceData.order.delivery_fee_paise)}</span></div>
              <div className="text-base font-bold text-[#202630] pt-1">
                Grand Total: {formatINRPaise(invoiceData.order.total_paise)}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Print Invoice
              </Button>
              <Button size="sm" onClick={() => setInvoiceData(null)}>Close</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Refund Request Modal */}
      {refundOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-[#202630]">
              Request Refund — {refundOrder.order_number}
            </h3>
            <form onSubmit={handleSubmitRefund} className="space-y-3">
              <div>
                <Label>Reason for Return / Refund</Label>
                <Textarea
                  required
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Damaged packaging, wrong item received, or cancelled order"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setRefundOrder(null)}>
                  Cancel
                </Button>
                <Button type="submit">Submit Request</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </StorefrontLayout>
  );
}

export function AccountOrdersPage() {
  const { user, reorderOrder } = useApp();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<CustomerOrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    apiFetch<{ orders: CustomerOrderRow[] }>('/api/orders')
      .then((d) => setOrders(d.orders))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-[#E1E5EB] pb-4">
          <div>
            <h1 className="text-2xl font-bold text-[#202630]">Order History &amp; Live Tracking</h1>
            <p className="text-xs text-[#526071]">Track active deliveries, reorder previous purchases, and check prescription review status</p>
          </div>
          <div className="flex gap-2">
            <Link to="/account">
              <Button size="sm" variant="outline">Account Dashboard</Button>
            </Link>
            <Link to="/pharmacy">
              <Button size="sm">Order Medicines</Button>
            </Link>
          </div>
        </div>

        {!user ? (
          <Card className="p-8 text-center space-y-4">
            <p className="text-sm text-[#526071]">Sign in to view your order history and live tracking links.</p>
            <Link to="/login?redirect=/account/orders">
              <Button>Sign In</Button>
            </Link>
          </Card>
        ) : loading ? (
          <div className="h-48 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
        ) : orders.length === 0 ? (
          <Card className="p-8 text-center space-y-3">
            <p className="text-sm font-semibold">No orders placed yet.</p>
            <Link to="/pharmacy">
              <Button>Start Shopping</Button>
            </Link>
          </Card>
        ) : (
          <div className="space-y-4">
            {orders.map((ord) => (
              <Card key={ord.id} className="p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E1E5EB] pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-[#202630]">{ord.order_number}</span>
                      <span className="text-xs text-[#526071]">· {formatIndianDateTime(ord.created_at)}</span>
                      {ord.fulfillment_type === 'STORE_PICKUP' && (
                        <span className="rounded bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-bold text-[#16835D]">
                          STORE PICKUP
                        </span>
                      )}
                    </div>
                    {ord.address_line1 && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-[#526071]">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{ord.address_line1}, {ord.address_city}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-[#16835D]">
                      {ORDER_STATUS_LABELS[ord.status] || ord.status}
                    </div>
                    <div className="text-xs text-[#526071] tabular-nums">
                      Total: {formatINRPaise(ord.total_paise)} · {ord.payment_method} ({ord.payment_status})
                    </div>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-[#202630]">
                  {ord.items.map((it) => (
                    <div key={it.id} className="flex justify-between">
                      <span>{it.medicine_name} × {it.quantity}</span>
                      <span className="tabular-nums font-medium">{formatINRPaise(it.line_total_paise)}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E1E5EB] text-xs">
                  <span className="font-mono text-[#526071]">
                    Invoice: {ord.invoice_number || 'Pending'} · Rx: {ord.prescription_status}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await reorderOrder(ord.id);
                        navigate('/cart');
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Reorder
                    </Button>
                    <Link to={`/track/${ord.order_number}`}>
                      <Button size="sm" variant="outline">Track Live Delivery →</Button>
                    </Link>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </StorefrontLayout>
  );
}
