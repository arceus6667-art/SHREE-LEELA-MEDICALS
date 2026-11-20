import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BellRing, ChevronLeft, ChevronRight, Plus, Upload, Zap } from 'lucide-react';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { MedicineCard } from '../../components/MedicineCard.tsx';
import { Button, Card, Input, Label, Select } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { formatINRPaise, type MedicineDTO } from '../../shared/types.ts';

interface CatalogResponse {
  medicines: MedicineDTO[];
  total: number;
  page: number;
  totalPages: number;
  typoSuggestedQuery: string | null;
  facets: {
    manufacturers: string[];
    forms: string[];
  };
}

function CatalogListing({ pageTitle }: { pageTitle: string }) {
  const { categories, store, user, showToast } = useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<CatalogResponse>({
    medicines: [],
    total: 0,
    page: 1,
    totalPages: 1,
    typoSuggestedQuery: null,
    facets: { manufacturers: [], forms: [] },
  });
  const [loading, setLoading] = useState(true);

  const [reqMedName, setReqMedName] = useState('');
  const [reqName, setReqName] = useState(user?.fullName || '');
  const [reqPhone, setReqPhone] = useState(user?.phone || '');
  const [reqSent, setReqSent] = useState(false);

  const q = searchParams.get('q') || '';
  const activeCat = searchParams.get('category') || '';
  const activeSub = searchParams.get('subcategory') || '';
  const manufacturer = searchParams.get('manufacturer') || '';
  const form = searchParams.get('form') || '';
  const inStock = searchParams.get('inStock') === 'true';
  const rxFilter = searchParams.get('rx') || 'all';
  const maxPrice = searchParams.get('maxPrice') || '';
  const sort = searchParams.get('sort') || 'relevance';
  const page = Number(searchParams.get('page') || 1);

  useEffect(() => {
    setReqMedName(q);
  }, [q]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (activeCat) params.set('category', activeCat);
    if (activeSub) params.set('subcategory', activeSub);
    if (manufacturer) params.set('manufacturer', manufacturer);
    if (form) params.set('form', form);
    if (inStock) params.set('inStock', 'true');
    if (rxFilter === 'rx') params.set('rx', 'true');
    if (rxFilter === 'otc') params.set('rx', 'false');
    if (maxPrice) params.set('maxPrice', maxPrice);
    if (sort) params.set('sort', sort);
    params.set('page', String(page));
    params.set('limit', '12');

    apiFetch<CatalogResponse>(`/api/catalog/medicines?${params.toString()}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [q, activeCat, activeSub, manufacturer, form, inStock, rxFilter, maxPrice, sort, page]);

  const updateFilter = (key: string, value: string, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    if (key === 'category') next.delete('subcategory');
    if (resetPage && key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const activeCategoryObj = categories.find((c) => c.slug === activeCat);

  const handleRequestAvailability = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/catalog/request-availability', {
        method: 'POST',
        body: JSON.stringify({
          medicineName: reqMedName || q || 'Requested medicine',
          requesterName: reqName,
          requesterPhone: reqPhone,
        }),
      });
      setReqSent(true);
      showToast('Availability request logged with pharmacy desk');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Request failed', 'error');
    }
  };

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[#E1E5EB] pb-4">
          <div>
            <h1 className="text-2xl font-bold text-[#202630]">{pageTitle}</h1>
            <p className="mt-1 text-xs text-[#526071]">
              {q ? `Results for "${q}" (${data.total} matches)` : `${data.total} pharmacist-approved products`}
              {store?.demoMode ? ' · Demonstration Catalog' : ''}
            </p>
            {data.typoSuggestedQuery && (
              <p className="mt-1 text-xs font-medium text-[#16835D]">
                Typo tolerance active: showing closest matches for &ldquo;{data.typoSuggestedQuery}&rdquo;
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Sort products"
              value={sort}
              onChange={(e) => updateFilter('sort', e.target.value)}
              className="h-9 w-44 text-xs"
            >
              <option value="relevance">Sort: Relevance</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="name_asc">Name: A to Z</option>
            </Select>

            <div className="flex items-center gap-1 rounded-lg bg-white border border-[#E1E5EB] p-1">
              {[
                { id: 'all', label: 'All' },
                { id: 'otc', label: 'OTC' },
                { id: 'rx', label: 'Rx' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => updateFilter('rx', tab.id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap cursor-pointer ${
                    rxFilter === tab.id
                      ? 'bg-[#D71920] text-white'
                      : 'text-[#526071] hover:text-[#202630]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Filters Sidebar */}
          <aside className="lg:col-span-3 space-y-4">
            <div className="rounded-lg border border-[#E1E5EB] bg-white p-4 space-y-4">
              <div>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#526071]">Categories</h2>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => updateFilter('category', '')}
                    className={`w-full text-left rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                      !activeCat ? 'bg-[#FFF5F5] text-[#D71920]' : 'text-[#526071] hover:bg-[#F5F7FA]'
                    }`}
                  >
                    All Categories
                  </button>
                  {categories.map((c) => (
                    <div key={c.id}>
                      <button
                        type="button"
                        onClick={() => updateFilter('category', c.slug)}
                        className={`w-full flex items-center justify-between text-left rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer ${
                          activeCat === c.slug
                            ? 'bg-[#FFF5F5] text-[#D71920]'
                            : 'text-[#526071] hover:bg-[#F5F7FA]'
                        }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="tabular-nums text-[11px]">{c.medicineCount ?? 0}</span>
                      </button>
                      {activeCat === c.slug && c.subcategories && c.subcategories.length > 0 && (
                        <div className="ml-3 mt-1 space-y-1 border-l border-[#E1E5EB] pl-2">
                          {c.subcategories.map((sub) => (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => updateFilter('subcategory', activeSub === sub.slug ? '' : sub.slug)}
                              className={`block w-full text-left text-[11px] py-1 cursor-pointer ${
                                activeSub === sub.slug ? 'font-bold text-[#D71920]' : 'text-[#526071] hover:text-[#202630]'
                              }`}
                            >
                              {sub.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-[#E1E5EB] pt-3 space-y-3">
                <div>
                  <Label className="text-xs">Manufacturer</Label>
                  <Select
                    value={manufacturer}
                    onChange={(e) => updateFilter('manufacturer', e.target.value)}
                    className="h-9 text-xs"
                  >
                    <option value="">All Manufacturers</option>
                    {data.facets.manufacturers.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Product Form</Label>
                  <Select
                    value={form}
                    onChange={(e) => updateFilter('form', e.target.value)}
                    className="h-9 text-xs"
                  >
                    <option value="">All Forms</option>
                    {data.facets.forms.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Max Price</Label>
                  <Select
                    value={maxPrice}
                    onChange={(e) => updateFilter('maxPrice', e.target.value)}
                    className="h-9 text-xs"
                  >
                    <option value="">Any Price</option>
                    <option value="10000">Under ₹100</option>
                    <option value="25000">Under ₹250</option>
                    <option value="50000">Under ₹500</option>
                  </Select>
                </div>

                <label className="flex items-center gap-2 text-xs font-medium text-[#202630] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inStock}
                    onChange={(e) => updateFilter('inStock', e.target.checked ? 'true' : '')}
                    className="accent-[#D71920]"
                  />
                  In Stock & Purchasable Only
                </label>

                <button
                  type="button"
                  onClick={() => setSearchParams(new URLSearchParams())}
                  className="text-xs font-medium text-[#D71920] hover:underline cursor-pointer"
                >
                  Clear All Filters
                </button>
              </div>
            </div>
          </aside>

          {/* Medicines Grid */}
          <div className="lg:col-span-9 space-y-6">
            {activeCategoryObj && (
              <div className="rounded-lg border border-[#E1E5EB] bg-white px-4 py-3 text-xs text-[#526071]">
                <strong className="text-[#202630]">{activeCategoryObj.name}:</strong> {activeCategoryObj.description}
              </div>
            )}

            {loading ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div key={n} className="h-72 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
                ))}
              </div>
            ) : data.medicines.length === 0 ? (
              <Card className="p-6 sm:p-8 space-y-5">
                <div className="text-center space-y-1">
                  <p className="text-base font-bold text-[#202630]">No products matched your search or filters.</p>
                  <p className="text-xs text-[#526071]">
                    Need a medicine that is currently unavailable or unlisted? Submit a Request Availability inquiry to Shree Leela Pharmacy.
                  </p>
                </div>

                {reqSent ? (
                  <div className="rounded-md border border-[#A7F3D0] bg-[#ECFDF5] p-4 text-center text-xs text-[#16835D] font-medium">
                    Availability request submitted. Our store team will contact you once checked.
                  </div>
                ) : (
                  <form onSubmit={handleRequestAvailability} className="mx-auto max-w-md space-y-3 rounded-md border border-[#E1E5EB] bg-[#F5F7FA] p-4">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#202630]">
                      <BellRing className="h-4 w-4 text-[#D71920]" />
                      Request Medicine Availability
                    </div>
                    <div>
                      <Label className="text-xs">Medicine / Product Name</Label>
                      <Input required value={reqMedName} onChange={(e) => setReqMedName(e.target.value)} placeholder="Enter medicine name & strength" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Your Name</Label>
                        <Input required value={reqName} onChange={(e) => setReqName(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Phone Number</Label>
                        <Input required value={reqPhone} onChange={(e) => setReqPhone(e.target.value)} />
                      </div>
                    </div>
                    <Button type="submit" size="sm" className="w-full">Request Availability</Button>
                  </form>
                )}

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setSearchParams(new URLSearchParams())}
                    className="text-xs font-semibold text-[#D71920] hover:underline cursor-pointer"
                  >
                    Reset Search & Filters
                  </button>
                </div>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
                  {data.medicines.map((med) => (
                    <MedicineCard key={med.id} medicine={med} highlightQuery={q} />
                  ))}
                </div>

                {data.totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-[#E1E5EB] pt-4 text-xs">
                    <span className="text-[#526071] tabular-nums">
                      Page {data.page} of {data.totalPages} ({data.total} items)
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={data.page <= 1}
                        onClick={() => updateFilter('page', String(data.page - 1), false)}
                      >
                        <ChevronLeft className="h-4 w-4" /> Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={data.page >= data.totalPages}
                        onClick={() => updateFilter('page', String(data.page + 1), false)}
                      >
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </StorefrontLayout>
  );
}

export function PharmacyPage() {
  return <CatalogListing pageTitle="Online Pharmacy Catalog" />;
}

export function SearchPage() {
  return <CatalogListing pageTitle="Search Medicines" />;
}

export function CategoriesPage() {
  const { categories, store } = useApp();
  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="mb-6 border-b border-[#E1E5EB] pb-4">
          <h1 className="text-2xl font-bold text-[#202630]">Pharmacy Categories & Subcategories</h1>
          <p className="mt-1 text-xs text-[#526071]">
            Catalogue navigation categories for {store?.name || 'Shree Leela Medical & General Stores'} (not treatment recommendations)
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <div key={cat.id} className="rounded-lg border border-[#E1E5EB] bg-white p-5 flex flex-col justify-between">
              <div>
                <Link
                  to={`/pharmacy?category=${cat.slug}`}
                  className="text-base font-bold text-[#202630] hover:text-[#D71920]"
                >
                  {cat.name}
                </Link>
                <p className="mt-1 text-xs text-[#526071] leading-relaxed">{cat.description}</p>
                {cat.subcategories && cat.subcategories.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {cat.subcategories.map((sub) => (
                      <Link
                        key={sub.id}
                        to={`/pharmacy?category=${cat.slug}&subcategory=${sub.slug}`}
                        className="rounded border border-[#E1E5EB] bg-[#F5F7FA] px-2 py-0.5 text-[11px] font-medium text-[#202630] hover:border-[#D71920]"
                      >
                        {sub.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#E1E5EB] pt-3 text-xs font-medium text-[#16835D]">
                <span className="tabular-nums">{cat.medicineCount ?? 0} approved products</span>
                <Link to={`/pharmacy?category=${cat.slug}`} className="text-[#D71920] hover:underline">
                  Browse →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </StorefrontLayout>
  );
}

export function QuickOrderPage() {
  const { addToCart, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MedicineDTO[]>([]);
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      apiFetch<{ medicines: MedicineDTO[] }>(`/api/catalog/medicines?q=${encodeURIComponent(query)}&limit=15`)
        .then((d) => setResults(d.medicines))
        .catch(() => setResults([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <StorefrontLayout>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E1E5EB] pb-4">
          <div>
            <h1 className="text-2xl font-bold text-[#202630] flex items-center gap-2">
              <Zap className="h-5 w-5 text-[#D71920]" />
              Quick Order
            </h1>
            <p className="mt-1 text-xs text-[#526071]">
              Search by medicine name, SKU, barcode, or generic salt and add packs quickly to your cart.
            </p>
          </div>
          <Link to="/upload-prescription">
            <Button variant="secondary" size="sm">
              <Upload className="h-4 w-4" />
              Or Upload Prescription
            </Button>
          </Link>
        </div>

        <Card className="p-4">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type medicine name, strength, SKU (e.g., DEMO-PAR-500), or composition..."
          />
        </Card>

        <Card className="divide-y divide-[#E1E5EB]">
          {results.map((med) => {
            const qty = qtyMap[med.id] || 1;
            return (
              <div key={med.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <Link to={`/medicine/${med.slug}`} className="text-sm font-semibold text-[#202630] hover:text-[#D71920]">
                    {med.name}
                  </Link>
                  <div className="text-xs text-[#526071]">
                    {med.genericName} · {med.manufacturerName} · {med.packSize} · SKU: <span className="font-mono">{med.sku}</span>
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-[#16835D]">
                    {med.requiresPrescription ? `Rx Required (${med.scheduleType})` : 'OTC'} ·{' '}
                    {med.canPurchase ? `${med.availableStock} available` : med.unavailableReason}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-bold tabular-nums mr-2">{formatINRPaise(med.salePricePaise)}</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, med.availableStock)}
                    value={qty}
                    onChange={(e) => setQtyMap((p) => ({ ...p, [med.id]: Math.max(1, Number(e.target.value)) }))}
                    className="h-9 w-16 rounded border border-[#E1E5EB] px-2 text-center text-sm tabular-nums"
                  />
                  <Button
                    size="sm"
                    disabled={!med.canPurchase}
                    onClick={async () => {
                      await addToCart(med.id, qty);
                      showToast(`Added ${qty} × ${med.name}`);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
    </StorefrontLayout>
  );
}
