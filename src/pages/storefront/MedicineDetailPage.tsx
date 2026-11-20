import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ShieldAlert, CheckCircle2, Plus, Minus, Pill, Upload, Bookmark, BellRing, MessageSquare } from 'lucide-react';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { Button, Card, Input, Label, Textarea } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { formatINRPaise, type MedicineDTO } from '../../shared/types.ts';

export function MedicineDetailPage() {
  const { slug } = useParams();
  const { cart, user, addToCart, updateCartQty, recordRecentlyViewed, showToast } = useApp();
  const [medicine, setMedicine] = useState<MedicineDTO | null>(null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [askOpen, setAskOpen] = useState(false);
  const [askName, setAskName] = useState(user?.fullName || '');
  const [askPhone, setAskPhone] = useState(user?.phone || '');
  const [askQuestion, setAskQuestion] = useState('');
  const [reqOpen, setReqOpen] = useState(false);
  const [reqName, setReqName] = useState(user?.fullName || '');
  const [reqPhone, setReqPhone] = useState(user?.phone || '');

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setActiveImageIdx(0);
    apiFetch<{ medicine: MedicineDTO }>(`/api/catalog/medicines/${slug}`)
      .then((d) => {
        setMedicine(d.medicine);
        recordRecentlyViewed(d.medicine.id);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug, recordRecentlyViewed]);

  const cartItem = medicine ? cart?.items.find((i) => i.medicineId === medicine.id) : undefined;
  const gallery = medicine?.images && medicine.images.length > 0
    ? medicine.images
    : medicine?.imageUrl
      ? [{ id: 'primary', imageUrl: medicine.imageUrl, altText: medicine.name, isPrimary: true, sortOrder: 0 }]
      : [];

  const handleSaveWishlist = async () => {
    if (!medicine) return;
    if (!user) {
      showToast('Sign in to save medicines to your wishlist', 'error');
      return;
    }
    try {
      await apiFetch('/api/saved-items', {
        method: 'POST',
        body: JSON.stringify({ medicineId: medicine.id }),
      });
      showToast('Saved to your Account Saved Products');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to save', 'error');
    }
  };

  const handleAskPharmacist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicine) return;
    try {
      await apiFetch('/api/pharmacist-question', {
        method: 'POST',
        body: JSON.stringify({
          medicineName: medicine.name,
          name: askName,
          phone: askPhone,
          question: askQuestion,
        }),
      });
      showToast('Question sent to registered pharmacist');
      setAskQuestion('');
      setAskOpen(false);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to submit question', 'error');
    }
  };

  const handleRequestAvailability = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicine) return;
    try {
      await apiFetch('/api/catalog/request-availability', {
        method: 'POST',
        body: JSON.stringify({
          medicineId: medicine.id,
          medicineName: medicine.name,
          requesterName: reqName,
          requesterPhone: reqPhone,
        }),
      });
      showToast('Availability request logged with pharmacy');
      setReqOpen(false);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Request failed', 'error');
    }
  };

  const discountPct =
    medicine && medicine.mrpPaise > medicine.salePricePaise
      ? Math.round(((medicine.mrpPaise - medicine.salePricePaise) / medicine.mrpPaise) * 100)
      : 0;

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-[#526071]">
          <Link to="/" className="hover:text-[#D71920]">Home</Link>
          <span>/</span>
          <Link to="/pharmacy" className="hover:text-[#D71920]">Pharmacy</Link>
          {medicine && (
            <>
              <span>/</span>
              <Link to={`/pharmacy?category=${medicine.categorySlug}`} className="hover:text-[#D71920]">
                {medicine.categoryName}
              </Link>
              <span>/</span>
              <span className="text-[#202630] font-medium truncate">{medicine.name}</span>
            </>
          )}
        </div>

        {loading ? (
          <div className="h-96 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
        ) : error || !medicine ? (
          <div className="rounded-lg border border-[#E1E5EB] bg-white p-10 text-center">
            <h1 className="text-lg font-bold text-[#202630]">{error || 'Medicine not found'}</h1>
            <Link to="/pharmacy" className="mt-4 inline-block text-sm font-medium text-[#D71920] hover:underline">
              Return to Pharmacy Catalog
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Left Multi-Image Gallery & Clinical Info */}
            <div className="lg:col-span-7 space-y-6">
              <div className="overflow-hidden rounded-lg border border-[#E1E5EB] bg-white p-5 space-y-4">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-md bg-[#F5F7FA]">
                  {gallery[activeImageIdx]?.imageUrl ? (
                    <img
                      src={gallery[activeImageIdx].imageUrl}
                      alt={gallery[activeImageIdx].altText}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Pill className="h-12 w-12 text-[#D71920]" />
                    </div>
                  )}
                </div>

                {gallery.length > 1 && (
                  <div className="flex items-center gap-2 overflow-x-auto">
                    {gallery.map((img, idx) => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => setActiveImageIdx(idx)}
                        className={`h-16 w-20 overflow-hidden rounded border cursor-pointer shrink-0 ${
                          idx === activeImageIdx ? 'border-[#D71920] ring-2 ring-[#D71920]/30' : 'border-[#E1E5EB]'
                        }`}
                      >
                        <img src={img.imageUrl} alt={img.altText} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-[#E1E5EB] bg-white p-6 space-y-5">
                <h2 className="text-base font-bold text-[#202630] border-b border-[#E1E5EB] pb-3">
                  Pharmacist-Approved Product Information
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm">
                  <div>
                    <div className="text-xs font-medium text-[#526071]">Composition</div>
                    <div className="mt-0.5 font-medium text-[#202630]">{medicine.composition}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#526071]">Manufacturer & Brand</div>
                    <div className="mt-0.5 font-medium text-[#202630]">
                      {medicine.manufacturerName}{medicine.brand ? ` (${medicine.brand})` : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#526071]">Product Form & Strength</div>
                    <div className="mt-0.5 font-medium text-[#202630]">
                      {medicine.dosageForm}{medicine.strength ? ` · ${medicine.strength}` : ''}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#526071]">Package Quantity</div>
                    <div className="mt-0.5 font-medium text-[#202630]">{medicine.packSize}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#526071]">SKU / Barcode / HSN</div>
                    <div className="mt-0.5 font-mono text-xs text-[#202630]">
                      {medicine.sku}{medicine.barcode ? ` · ${medicine.barcode}` : ''} · HSN {medicine.hsnCode || '3004'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#526071]">Nearest Batch Expiry</div>
                    <div className="mt-0.5 font-mono text-xs text-[#202630]">
                      {medicine.nearestExpiry || 'Out of unexpired stock'}
                    </div>
                  </div>
                </div>

                {medicine.usageSummary && (
                  <div className="border-t border-[#E1E5EB] pt-4">
                    <h3 className="text-sm font-semibold text-[#202630]">Pharmacist-Approved Description</h3>
                    <p className="mt-1 text-sm text-[#526071]">{medicine.usageSummary}</p>
                  </div>
                )}

                {medicine.storageInstructions && (
                  <div className="border-t border-[#E1E5EB] pt-4">
                    <h3 className="text-sm font-semibold text-[#202630]">Storage Instructions</h3>
                    <p className="mt-1 text-sm text-[#526071]">{medicine.storageInstructions}</p>
                  </div>
                )}

                {medicine.safetyAdvice && (
                  <div className="border-t border-[#E1E5EB] pt-4">
                    <h3 className="text-sm font-semibold text-[#202630]">Approved Safety Warnings</h3>
                    <p className="mt-1 text-sm text-[#526071]">{medicine.safetyAdvice}</p>
                  </div>
                )}

                {medicine.sideEffectsSummary && (
                  <div className="border-t border-[#E1E5EB] pt-4">
                    <h3 className="text-sm font-semibold text-[#202630]">Listed Side Effects</h3>
                    <p className="mt-1 text-sm text-[#526071]">{medicine.sideEffectsSummary}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Purchase Module */}
            <div className="lg:col-span-5">
              <div className="sticky top-24 rounded-lg border border-[#E1E5EB] bg-white p-6 space-y-5">
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[#526071]">
                    <span>{medicine.categoryName}</span>
                    <span>·</span>
                    <span>{medicine.scheduleType}</span>
                    {medicine.isDemoData && (
                      <>
                        <span>·</span>
                        <span className="font-medium text-[#B5121B]">Demonstration Listing</span>
                      </>
                    )}
                  </div>
                  <h1 className="text-xl font-bold text-[#202630]">{medicine.name}</h1>
                  <p className="mt-1 text-xs text-[#526071]">
                    By {medicine.manufacturerName} · {medicine.packSize}
                  </p>
                </div>

                <div className="rounded-md bg-[#F5F7FA] p-4 space-y-1.5">
                  <div className="flex items-baseline gap-3 tabular-nums">
                    <span className="text-2xl font-bold text-[#202630]">
                      {formatINRPaise(medicine.salePricePaise)}
                    </span>
                    {discountPct > 0 && (
                      <>
                        <span className="text-sm text-[#6B7686] line-through">
                          MRP {formatINRPaise(medicine.mrpPaise)}
                        </span>
                        <span className="text-xs font-bold text-[#16835D]">{discountPct}% off</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-[#526071]">
                    Inclusive of GST ({medicine.gstPercent}%) · {medicine.packSize}
                  </p>
                </div>

                {medicine.requiresPrescription ? (
                  <div className="flex items-start gap-2.5 rounded-md border border-[#F5C2C7] bg-[#FFF5F5] p-3 text-xs text-[#B5121B]">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <div className="font-semibold">Prescription Required ({medicine.scheduleType})</div>
                      <div className="mt-0.5 text-[#526071]">
                        Valid doctor prescription required. Online payment and dispatch occur only after registered pharmacist review.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs font-medium text-[#16835D]">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Over-the-Counter Product</span>
                  </div>
                )}

                <div className="flex items-center justify-between border-y border-[#E1E5EB] py-3 text-xs">
                  <span className="text-[#526071]">Store Stock (Mira Road East)</span>
                  <span className={`font-semibold tabular-nums ${medicine.canPurchase ? 'text-[#16835D]' : 'text-[#B5121B]'}`}>
                    {medicine.canPurchase
                      ? `${medicine.availableStock} packs available`
                      : medicine.unavailableReason}
                  </span>
                </div>

                {!medicine.canPurchase ? (
                  <div className="space-y-3">
                    <Button size="lg" className="w-full" disabled>
                      Purchasing Disabled ({medicine.isRecalled ? 'Recalled' : medicine.onlineSaleRestricted ? 'Restricted' : 'Unavailable'})
                    </Button>
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setReqOpen((v) => !v)}>
                      <BellRing className="h-4 w-4 text-[#D71920]" />
                      Request Availability from Store
                    </Button>
                    {reqOpen && (
                      <form onSubmit={handleRequestAvailability} className="space-y-2.5 rounded-md border border-[#E1E5EB] bg-[#F5F7FA] p-3">
                        <div>
                          <Label className="text-xs">Your Name</Label>
                          <Input required value={reqName} onChange={(e) => setReqName(e.target.value)} />
                        </div>
                        <div>
                          <Label className="text-xs">Mobile Number</Label>
                          <Input required value={reqPhone} onChange={(e) => setReqPhone(e.target.value)} />
                        </div>
                        <Button type="submit" size="sm" className="w-full">Submit Request</Button>
                      </form>
                    )}
                  </div>
                ) : cartItem ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-md border border-[#D71920] bg-[#FFF5F5]">
                      <button
                        type="button"
                        onClick={() => updateCartQty(medicine.id, cartItem.quantity - 1)}
                        className="flex h-11 w-14 items-center justify-center text-[#D71920] hover:bg-[#FEE2E2] cursor-pointer"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="text-sm font-bold text-[#202630] tabular-nums">
                        {cartItem.quantity} in Cart
                      </span>
                      <button
                        type="button"
                        onClick={() => updateCartQty(medicine.id, cartItem.quantity + 1)}
                        className="flex h-11 w-14 items-center justify-center text-[#D71920] hover:bg-[#FEE2E2] cursor-pointer"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <Link to="/cart" className="block">
                      <Button variant="secondary" className="w-full" size="lg">
                        Proceed to Cart
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => addToCart(medicine.id, 1)}
                  >
                    Add to Cart
                  </Button>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E1E5EB] text-xs">
                  <button
                    type="button"
                    onClick={handleSaveWishlist}
                    className="inline-flex items-center gap-1.5 font-medium text-[#202630] hover:text-[#D71920] cursor-pointer"
                  >
                    <Bookmark className="h-3.5 w-3.5" /> Save for Later
                  </button>
                  <button
                    type="button"
                    onClick={() => setAskOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 font-medium text-[#16835D] hover:underline cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> Ask the Pharmacist
                  </button>
                </div>

                {askOpen && (
                  <Card className="p-4 bg-[#F5F7FA] space-y-3">
                    <div className="text-xs font-bold text-[#202630]">Contact Pharmacist About This Product</div>
                    <form onSubmit={handleAskPharmacist} className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[11px]">Name</Label>
                          <Input required value={askName} onChange={(e) => setAskName(e.target.value)} className="h-8 text-xs" />
                        </div>
                        <div>
                          <Label className="text-[11px]">Phone</Label>
                          <Input required value={askPhone} onChange={(e) => setAskPhone(e.target.value)} className="h-8 text-xs" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[11px]">Product-Related Question</Label>
                        <Textarea required value={askQuestion} onChange={(e) => setAskQuestion(e.target.value)} placeholder="Ask about availability, pack size, or storage..." className="text-xs min-h-[70px]" />
                      </div>
                      <Button type="submit" size="sm" variant="secondary" className="w-full">Send to Pharmacist Desk</Button>
                    </form>
                  </Card>
                )}

                {medicine.requiresPrescription && (
                  <Link
                    to="/upload-prescription"
                    className="flex items-center justify-center gap-2 text-xs font-medium text-[#16835D] hover:underline"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload Prescription in Advance
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </StorefrontLayout>
  );
}
