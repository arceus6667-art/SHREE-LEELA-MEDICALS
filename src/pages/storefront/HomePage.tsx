import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin,
  Clock,
  Phone,
  Upload,
  ArrowRight,
  Search,
  HeadphonesIcon,
  ExternalLink,
  FileCheck2,
  Store,
  PackageSearch,
  ChevronDown,
} from 'lucide-react';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { MedicineCard } from '../../components/MedicineCard.tsx';
import { Button, Card } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import '../../styles/storefront-home.css';
import type { CategoryDTO, MedicineDTO, PromotionBannerDTO, PublicStoreInfo } from '../../shared/types.ts';

interface HomepagePayload {
  store: PublicStoreInfo;
  promotions: PromotionBannerDTO[];
  categories: CategoryDTO[];
  featuredMedicines: MedicineDTO[];
  essentialMedicines: MedicineDTO[];
  popularSearches: string[];
}

const categoryArtwork: Record<string, number> = {
  'tablets-and-capsules': 0, 'syrups-and-oral-liquids': 0, 'first-aid': 1,
  'baby-care': 2, 'skin-care-medicines': 3, 'personal-care': 3,
  'vitamins-and-supplements': 4, 'diabetes-care': 5, 'medical-devices': 6,
  'heart-and-blood-pressure': 6, 'pharmacy-essentials': 7, 'eye-and-ear-care': 3,
  'pain-relief': 1, 'digestive-health': 4, 'respiratory-care': 6,
};

export function HomePage() {
  const { store, categories, recentlyViewedIds, deliveryLocation } = useApp();
  const [homepage, setHomepage] = useState<HomepagePayload | null>(null);
  const [recentMeds, setRecentMeds] = useState<MedicineDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);

  useEffect(() => {
    apiFetch<HomepagePayload>('/api/homepage')
      .then(setHomepage)
      .catch(() => setCatalogError(true))
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
  const orderedCategories = [...activeCategories].sort((first, second) => {
    const featured = ['tablets-and-capsules', 'first-aid', 'baby-care', 'skin-care-medicines', 'vitamins-and-supplements', 'diabetes-care', 'medical-devices', 'pharmacy-essentials'];
    const rank = (slug: string) => featured.includes(slug) ? featured.indexOf(slug) : featured.length;
    return rank(first.slug) - rank(second.slug);
  });
  const promotions = homepage?.promotions || [];
  const featured = homepage?.featuredMedicines || [];
  const essentials = homepage?.essentialMedicines || [];
  const popularSearches = homepage?.popularSearches || [];

  return (
    <StorefrontLayout>
      <div className="slm-home mx-auto max-w-7xl px-4 sm:px-6">
        <section className="slm-hero" aria-labelledby="storefront-title">
          <div className="slm-hero-copy">
            <p className="slm-location"><MapPin size={16} /> {store?.city || 'Mira Road East'}</p>
            <h1 id="storefront-title">Your neighbourhood<br className="hidden lg:block" /> pharmacy, online.</h1>
            <p>Browse medicines and healthcare essentials from Shree Leela Medical &amp; General Stores.</p>
            <div className="slm-actions">
              <Link className="slm-action slm-action-primary" to="/pharmacy">Browse pharmacy <ArrowRight size={17} /></Link>
              <Link className="slm-action slm-action-secondary" to="/upload-prescription"><Upload size={17} /> Upload prescription</Link>
            </div>
          </div>
          <div className="slm-hero-side">
            <div><FileCheck2 size={22} /><span><strong>Prescription review</strong><small>Upload a photo or PDF for our pharmacist.</small></span></div>
            <div><Store size={22} /><span><strong>Store pickup and delivery</strong><small>{deliveryLocation.serviceable ? `Delivery for PIN ${deliveryLocation.pincode}` : 'Check your PIN code for delivery availability.'}</small></span></div>
            <Link to="/account/orders"><PackageSearch size={22} /><span><strong>Track your order</strong><small>Check the status of an existing order.</small></span><ArrowRight size={17} /></Link>
          </div>
        </section>
      </div>

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

      <section className="slm-home mx-auto max-w-7xl px-4 sm:px-6 pt-9" aria-labelledby="shop-categories">
        <div className="slm-section-heading">
          <div>
            <h2 id="shop-categories">Shop by category</h2>
            <p>Find what you need in the pharmacy catalogue.</p>
          </div>
          <Link to="/categories">All categories <ArrowRight size={16} /></Link>
        </div>
        {activeCategories.length > 0 ? (
          <>
            <div className="slm-category-grid" id="home-category-grid">
              {(showAllCategories ? orderedCategories : orderedCategories.slice(0, 8)).map((category) => {
                const artwork = categoryArtwork[category.slug] ?? 7;
                return (
                  <Link key={category.id} to={`/pharmacy?category=${encodeURIComponent(category.slug)}`} className="slm-category">
                    <img src={`/images/categories/category-${artwork + 1}.webp`} alt="" loading="lazy" width="320" height="240" />
                    <span>{category.name}<ArrowRight size={15} aria-hidden="true" /></span>
                  </Link>
                );
              })}
            </div>
            {activeCategories.length > 8 && (
              <button type="button" className="slm-category-toggle" aria-expanded={showAllCategories} aria-controls="home-category-grid" onClick={() => setShowAllCategories((value) => !value)}>
                {showAllCategories ? 'Show fewer categories' : 'Show more categories'}
                <ChevronDown size={17} style={{ transform: showAllCategories ? 'rotate(180deg)' : undefined }} />
              </button>
            )}
          </>
        ) : (
          <p role="status" className="slm-catalog-message">
            {loading ? 'Loading categories…' : catalogError ? 'The catalogue is temporarily unavailable.' : 'The store is adding its online catalogue.'}
          </p>
        )}
      </section>

      {promotions.length > 0 && (
        <section className="slm-home mx-auto max-w-7xl px-4 sm:px-6 pt-9" aria-label="Store updates">
          <div className="grid gap-4 md:grid-cols-2">
            {promotions.map((promotion) => (
              <Link key={promotion.id} to={promotion.ctaLink} className="slm-promotion">
                <div><h2>{promotion.title}</h2><p>{promotion.subtitle}</p></div>
                <span>{promotion.ctaLabel} <ArrowRight size={16} /></span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {featured.length > 0 && (
        <section className="slm-home mx-auto max-w-7xl px-4 sm:px-6 pt-9" aria-labelledby="featured-products">
          <div className="slm-section-heading">
            <h2 id="featured-products">Featured products</h2>
            <Link to="/pharmacy">View catalogue <ArrowRight size={16} /></Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {featured.map((medicine) => <MedicineCard key={medicine.id} medicine={medicine} />)}
          </div>
        </section>
      )}

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
            {store?.storefrontPhotoUrl && (
              <div className="sm:col-span-5">
                <img src={store.storefrontPhotoUrl} alt="Shree Leela Medical and General Stores storefront" loading="lazy" width="480" height="340" className="h-44 w-full rounded-xl object-cover" />
              </div>
            )}
            <div className={store?.storefrontPhotoUrl ? 'sm:col-span-7 space-y-2.5' : 'sm:col-span-12 space-y-2.5'}>
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
