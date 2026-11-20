import React, { useState } from 'react';
import { MapPin, Phone, Clock, ExternalLink, Building2, ShieldCheck, Truck, Store } from 'lucide-react';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { formatINRPaise } from '../../shared/types.ts';

export function ContactPage() {
  const { store, user, serviceablePincodes, showToast } = useApp();
  const [name, setName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ ticketId: string }>('/api/contact', {
        method: 'POST',
        body: JSON.stringify({ name, phone, email, subject, message }),
      });
      setSubmittedId(res.ticketId);
      setSubject('');
      setMessage('');
      showToast('Support inquiry submitted');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to send inquiry', 'error');
    }
  };

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
        <div className="border-b border-[#E1E5EB] pb-4">
          <h1 className="text-2xl font-bold text-[#202630]">
            About {store?.name || 'Shree Leela Medical & General Stores'} &amp; Support
          </h1>
          <p className="mt-1 text-xs text-[#526071]">
            Neighbourhood pharmacy in Mira Road East serving verified medicines, prescription dispensing, and local delivery.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5 space-y-6">
            <Card className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                {store?.logoUrl ? (
                  <img
                    src={store.logoUrl}
                    alt={store.name}
                    referrerPolicy="no-referrer"
                    className="h-12 w-12 rounded border border-[#E1E5EB] object-contain"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-[#D71920] bg-[#FFF5F5] text-xs font-bold text-[#D71920]">
                    SLM
                  </div>
                )}
                <div>
                  <h2 className="text-base font-bold text-[#202630]">
                    {store?.name || 'Shree Leela Medical & General Stores'}
                  </h2>
                  <p className="text-xs text-[#526071]">
                    Store Code: {store?.code || 'SLM-MIRA-01'}
                  </p>
                </div>
              </div>

              <div className="space-y-3 text-sm text-[#526071]">
                <p className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#D71920]" />
                  <span>
                    {store
                      ? `${store.addressLine1}${store.landmark ? `, ${store.landmark}` : ''}, ${store.city}, ${store.state} ${store.postalCode}`
                      : 'Gaurav Avenue, near GCC Club, Hatkesh Road, Mira Road East, Maharashtra'}
                  </span>
                </p>
                <p className="flex items-center gap-2.5">
                  <Phone className="h-4 w-4 shrink-0 text-[#16835D]" />
                  <span>{store?.phone || '+91 72082 82337'}</span>
                </p>
                <p className="flex items-center gap-2.5">
                  <Clock className="h-4 w-4 shrink-0 text-[#202630]" />
                  <span>Operating Hours: {store?.operatingHours || '8 AM to 11 PM'}</span>
                </p>
                <p className="flex items-center gap-2.5 text-xs">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[#16835D]" />
                  <span>
                    Drug License: {store?.drugLicenseNumber || 'MH-MZ3-DEMO-2026'} · GSTIN: {store?.gstin || '27AABCS1429B1ZS'}
                  </span>
                </p>
              </div>
              <a
                href={store?.googleMapsUrl || 'https://maps.app.goo.gl/t2GPkm2kVdTe4Cw46'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D71920] hover:underline"
              >
                Open Directions in Google Maps
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Card>

            <Card className="p-5">
              {store?.storefrontPhotoUrl ? (
                <img
                  src={store.storefrontPhotoUrl}
                  alt={store.name}
                  referrerPolicy="no-referrer"
                  className="h-48 w-full rounded object-cover"
                />
              ) : (
                <div className="flex h-48 flex-col items-center justify-center rounded border border-dashed border-[#CBD2D9] bg-[#F5F7FA] p-4 text-center">
                  <Building2 className="mb-2 h-8 w-8 text-[#D71920]" />
                  <div className="text-xs font-semibold text-[#202630]">Replaceable Storefront Photo Placeholder</div>
                  <div className="mt-1 text-[11px] text-[#526071]">
                    Upload the verified storefront photograph in Admin Settings.
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <Card className="p-6">
              <h2 className="mb-4 text-base font-bold text-[#202630]">Send an Inquiry or Pharmacist Query</h2>
              {submittedId && (
                <div className="mb-4 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] p-3 text-xs text-[#16835D]">
                  Inquiry logged (Ticket #{submittedId.slice(0, 8)}). Our pharmacy desk will respond during operating hours ({store?.operatingHours || '8 AM to 11 PM'}).
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Your Name</Label>
                    <Input required value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <Label>Phone Number</Label>
                    <Input required value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Email (Optional)</Label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label>Subject</Label>
                  <Input
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Medicine availability, prescription status, or order support"
                  />
                </div>
                <div>
                  <Label>Message</Label>
                  <Textarea required value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
                <Button type="submit" size="lg">Submit Support Ticket</Button>
              </form>
            </Card>

            <Card className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-[#16835D]" />
                <h2 className="text-base font-bold text-[#202630]">Active Delivery Coverage &amp; Store Pickup</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#E1E5EB] text-left text-[#526071]">
                      <th className="py-2">PIN Code</th>
                      <th className="py-2">Area</th>
                      <th className="py-2 text-right">Est. Arrival</th>
                      <th className="py-2 text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E1E5EB]">
                    {serviceablePincodes.map((pin) => (
                      <tr key={pin.id}>
                        <td className="py-2 font-mono font-bold">{pin.pincode}</td>
                        <td className="py-2 text-[#526071]">{pin.areaName}</td>
                        <td className="py-2 text-right tabular-nums">~{pin.estimatedMins} mins</td>
                        <td className="py-2 text-right tabular-nums font-medium">
                          {formatINRPaise(pin.deliveryFeePaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded bg-[#F5F7FA] p-3 text-xs text-[#526071] flex items-start gap-2">
                <Store className="h-4 w-4 shrink-0 text-[#16835D] mt-0.5" />
                <span>
                  <strong className="text-[#202630]">Free Counter Store Pickup:</strong> Customers outside listed PIN codes or preferring direct collection can select Store Pickup at checkout and collect orders at Gaurav Avenue, Hatkesh Road between {store?.operatingHours || '8 AM to 11 PM'}.
                </span>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}
