import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin,
  Clock,
  Phone,
  Upload,
  ArrowRight,
  Building2,
  Search,
  HeadphonesIcon,
  ExternalLink,
  ShieldCheck,
  FileCheck2,
  Store,
} from 'lucide-react';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { MedicineCard } from '../../components/MedicineCard.tsx';
import { Button, Card } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import type { CategoryDTO, MedicineDTO, PromotionBannerDTO, PublicStoreInfo } from '../../shared/types.ts';

interface HomepagePayload {
  store: PublicStoreInfo;
  promotions: PromotionBannerDTO[];
  categories: CategoryDTO[];
  featuredMedicines: MedicineDTO[];
  essentialMedicines: MedicineDTO[];
  popularSearches: string[];
}

export function HomePage() {
  const { store, categories, recentlyViewedIds, deliveryLocation } = useApp();
  const [homepage, setHomepage] = useState<HomepagePayload | null>(null);
  const [recentMeds, setRecentMeds] = useState<MedicineDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<HomepagePayload>('/api/homepage')
      .then(setHomepage)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (recentlyViewedIds.length === 0) return;
    apiFetch<{ medicines: MedicineDTO[] }>('/api/catalog/medicines/by-ids', {
      method: 'POST',
      body: JSON.stringify({ ids: recentlyViewedIds }),
    })
      .then((d) => setRecentMeds(d.medicines))
      .catch(() => setRecentMeds([]));
  }, [recentlyViewedIds]);

  const activeCategories = homepage?.categories || categories;
  const promotions = homepage?.promotions || [];
  const featured = homepage?.featuredMedicines || [];
  const essentials = homepage?.essentialMedicines || [];
  const popularSearches = homepage?.popularSearches || [];

  return (
    <StorefrontLayout>
      {/* Promotional Banners (Admin Configurable) */}
      {promotions.length > 0 && (
        <section className="border-b border-[#E1E5EB] bg-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {promotions.map((promo, idx) => (
              <div
                key={promo.id}
                className={`flex flex-col justify-between rounded-lg border p-5 ${
                  idx === 0
                    ? 'border-[#F5C2C7] bg-[#FFF5F5]'
                    : 'border-[#A7F3D0] bg-[#ECFDF5]'
                }`}
              >
                <div className="space-y-2">
                  {promo.badgeText && (
                    <span
                      className={`inline-block text-[11px] font-bold uppercase tracking-wide ${
                        idx === 0 ? 'text-[#B5121B]' : 'text-[#16835D]'
                      }`}
                    >
                      {promo.badgeText}
                    </span>
                  )}
                  <h2 className="text-lg font-bold text-[#202630]">{promo.title}</h2>
                  <p className="text-xs sm:text-sm text-[#526071] leading-relaxed">{promo.subtitle}</p>
                </div>
                <div className="mt-4">
                  <Link to={promo.ctaLink}>
                    <Button size="sm" variant={idx === 0 ? 'default' : 'secondary'}>
                      {promo.ctaLabel}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Prominent Prescription Upload & Serviceability Strip */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 rounded-lg border border-[#E1E5EB] bg-white p-5 sm:p-6">
          <div className="lg:col-span-7 flex flex-col justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#16835D]">
                <span>{store?.city || 'Mira Road East'} Online Pharmacy</span>
                <span aria-hidden="true" className="text-[#CBD2D9]">·</span>
                <span>Open {store?.operatingHours || '8 AM to 11 PM'}</span>
                <span aria-hidden="true" className="text-[#CBD2D9]">·</span>
                <span>PIN {deliveryLocation.pincode} {deliveryLocation.serviceable ? '(Serviceable)' : '(Pickup)'}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#202630]">
                Order Medicines & Healthcare Essentials
              </h1>
              <p className="text-sm text-[#526071] leading-relaxed max-w-2xl">
                Browse pharmacist-approved medicines, OTC healthcare essentials, and home medical devices from {store?.name || 'Shree Leela Medical & General Stores'}. Prescription medicines are dispensed strictly upon registered pharmacist verification.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link to="/upload-prescription">
                <Button size="lg">
                  <Upload className="h-4 w-4" />
                  Upload Prescription
                </Button>
              </Link>
              <Link to="/pharmacy">
                <Button variant="outline" size="lg">
                  Browse Full Pharmacy
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/quick-order">
                <Button variant="secondary" size="lg">
                  Quick Order by SKU / Name
                </Button>
              </Link>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-lg border border-[#E1E5EB] bg-[#F5F7FA] p-4 flex flex-col justify-between gap-3">
            <div className="flex items-start gap-3">
              <FileCheck2 className="mt-0.5 h-5 w-5 text-[#16835D] shrink-0" />
              <div>
                <h2 className="text-sm font-bold text-[#202630]">Have a Doctor&apos;s Prescription?</h2>
                <p className="mt-0.5 text-xs text-[#526071]">
                  Upload a photo or PDF. Our registered pharmacist verifies Schedule H items and prepares an itemized confirmation before online payment is collected.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-[#E1E5EB] pt-3 text-xs text-[#526071]">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-[#D71920]" />
                <span>Batch & Expiry Verified</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Store className="h-4 w-4 text-[#16835D]" />
                <span>Pickup or Home Delivery</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Popular Medicine Searches */}
      {popularSearches.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-6">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E1E5EB] bg-white px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#526071] mr-1">
              <Search className="h-3.5 w-3.5 text-[#D71920]" />
              Popular Searches:
            </span>
            {popularSearches.map((term) => (
              <Link
                key={term}
                to={`/search?q=${encodeURIComponent(term)}`}
                className="rounded border border-[#E1E5EB] bg-[#F5F7FA] px-2.5 py-1 text-xs font-medium text-[#202630] hover:border-[#D71920] hover:text-[#D71920] transition-colors"
              >
                {term}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Shop by Category (13 Pharmacy Categories) */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-10">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#202630]">Shop by Pharmacy Category</h2>
            <p className="text-xs text-[#526071]">
              Catalogue navigation categories for pharmacist-approved products (not treatment recommendations)
            </p>
          </div>
          <Link to="/categories" className="text-sm font-medium text-[#D71920] hover:underline whitespace-nowrap shrink-0">
            All Categories →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {activeCategories.map((cat) => (
            <Link
              key={cat.id}
              to={`/pharmacy?category=${cat.slug}`}
              className="rounded-lg border border-[#E1E5EB] bg-white p-3.5 transition-colors hover:border-[#D71920]"
            >
              <div className="text-sm font-semibold text-[#202630]">{cat.name}</div>
              <div className="mt-1 text-xs text-[#526071] line-clamp-2">{cat.description}</div>
              <div className="mt-2.5 text-xs font-medium text-[#16835D] tabular-nums">
                {cat.medicineCount ?? 0} product{(cat.medicineCount ?? 0) === 1 ? '' : 's'}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Featured Products (Admin Configurable) */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-10">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#202630]">Featured Pharmacy Products</h2>
            <p className="text-xs text-[#526071]">
              Curated in Admin Dashboard · Only pharmacist-approved listings displayed
            </p>
          </div>
          <Link to="/pharmacy" className="text-sm font-medium text-[#D71920] hover:underline whitespace-nowrap shrink-0">
            View Full Catalog →
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-72 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {featured.map((med) => (
              <MedicineCard key={med.id} medicine={med} />
            ))}
          </div>
        )}
      </section>

      {/* Pharmacy Essentials */}
      {essentials.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-10">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-[#202630]">Pharmacy Essentials</h2>
              <p className="text-xs text-[#526071]">Daily hygiene, first aid, antacids, and nutritional supplements</p>
            </div>
            <Link to="/pharmacy?category=pharmacy-essentials" className="text-sm font-medium text-[#D71920] hover:underline whitespace-nowrap shrink-0">
              Browse Essentials →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {essentials.map((med) => (
              <MedicineCard key={med.id} medicine={med} />
            ))}
          </div>
        </section>
      )}

      {/* Recently Viewed Products */}
      {recentMeds.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-10">
          <div className="mb-5">
            <h2 className="text-xl font-bold text-[#202630]">Recently Viewed Products</h2>
            <p className="text-xs text-[#526071]">Medicines and items you checked recently</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {recentMeds.slice(0, 4).map((med) => (
              <MedicineCard key={med.id} medicine={med} />
            ))}
          </div>
        </section>
      )}

      {/* Store Information & Customer Support */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-10">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-7 p-6 grid grid-cols-1 gap-5 sm:grid-cols-12 items-center">
            <div className="sm:col-span-5">
              {store?.storefrontPhotoUrl ? (
                <img
                  src={store.storefrontPhotoUrl}
                  alt={store.name}
                  referrerPolicy="no-referrer"
                  className="h-44 w-full rounded-md object-cover border border-[#E1E5EB]"
                />
              ) : (
                <div className="flex h-44 flex-col items-center justify-center rounded-md border border-dashed border-[#CBD2D9] bg-[#F5F7FA] p-4 text-center">
                  <Building2 className="mb-2 h-8 w-8 text-[#D71920]" />
                  <div className="text-xs font-semibold text-[#202630]">Storefront Photo Placeholder</div>
                  <div className="mt-1 text-[11px] text-[#526071]">
                    Replaceable in Admin Store Settings
                  </div>
                </div>
              )}
            </div>
            <div className="sm:col-span-7 space-y-2.5">
              <h2 className="text-lg font-bold text-[#202630]">
                {store?.name || 'Shree Leela Medical & General Stores'}
              </h2>
              <p className="flex items-start gap-2 text-xs sm:text-sm text-[#526071]">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#D71920]" />
                <span>
                  {store
                    ? `${store.addressLine1}${store.landmark ? `, ${store.landmark}` : ''}, ${store.city}, ${store.state} ${store.postalCode}`
                    : 'Gaurav Avenue, near GCC Club, Hatkesh Road, Mira Road East, Maharashtra'}
                </span>
              </p>
              <div className="flex flex-wrap gap-4 text-xs sm:text-sm text-[#526071]">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-[#16835D]" />
                  {store?.operatingHours || '8 AM to 11 PM'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-4 w-4 text-[#202630]" />
                  {store?.phone || '+91 72082 82337'}
                </span>
              </div>
              <div className="pt-1 flex flex-wrap gap-4 text-xs">
                <a
                  href={store?.googleMapsUrl || 'https://maps.app.goo.gl/t2GPkm2kVdTe4Cw46'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-[#D71920] hover:underline"
                >
                  Google Maps Directions <ExternalLink className="h-3 w-3" />
                </a>
                <Link to="/contact" className="font-semibold text-[#16835D] hover:underline">
                  About Store & Coverage →
                </Link>
              </div>
            </div>
          </Card>

          <Card className="lg:col-span-5 p-6 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#16835D]">
                <HeadphonesIcon className="h-4 w-4" />
                Customer & Pharmacist Support
              </div>
              <h2 className="text-lg font-bold text-[#202630]">Need Help with an Order or Medicine?</h2>
              <p className="text-xs sm:text-sm text-[#526071]">
                Contact our Hatkesh Road store desk directly on {store?.phone || '+91 72082 82337'} between {store?.operatingHours || '8 AM and 11 PM'}, or raise an online support ticket.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link to="/contact">
                <Button variant="outline" size="sm">Open Support Desk</Button>
              </Link>
              <Link to="/account/orders">
                <Button variant="secondary" size="sm">Track Existing Order</Button>
              </Link>
            </div>
          </Card>
        </div>
      </section>
    </StorefrontLayout>
  );
}
