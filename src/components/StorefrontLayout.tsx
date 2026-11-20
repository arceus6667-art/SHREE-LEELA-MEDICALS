import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Search,
  ShoppingCart,
  Upload,
  MapPin,
  Phone,
  Clock,
  User,
  ExternalLink,
  Menu,
  X,
  Zap,
  Package,
  Home,
  Pill,
  ChevronDown,
  History,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { formatINRPaise } from '../shared/types.ts';

interface SearchSuggestion {
  id: string;
  slug: string;
  name: string;
  genericName: string;
  manufacturerName: string;
  strength: string | null;
  packSize: string;
  salePricePaise: number;
  requiresPrescription: boolean;
  canPurchase: boolean;
  imageUrl: string;
  fuzzyMatch: boolean;
}

export function StorefrontLayout({
  children,
  hideSearch = false,
}: {
  children: React.ReactNode;
  hideSearch?: boolean;
}) {
  const {
    store,
    user,
    cart,
    categories,
    serviceablePincodes,
    deliveryLocation,
    setDeliveryPincode,
    recentSearches,
    addRecentSearch,
    clearRecentSearches,
    showToast,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCat, setSelectedCat] = useState('');
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState(deliveryLocation.pincode);
  const [checkingPin, setCheckingPin] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const searchWrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const cartCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  useEffect(() => {
    setPinInput(deliveryLocation.pincode);
  }, [deliveryLocation.pincode]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced Autocomplete Search
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      apiFetch<{ suggestions: SearchSuggestion[] }>(`/api/catalog/suggest?q=${encodeURIComponent(q)}`)
        .then((d) => setSuggestions(d.suggestions))
        .catch(() => setSuggestions([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
      addRecentSearch(searchQuery.trim());
    }
    if (selectedCat) params.set('category', selectedCat);
    setDropdownOpen(false);
    navigate(`/search?${params.toString()}`);
  };

  const handleCheckPin = async (pinToCheck: string) => {
    setCheckingPin(true);
    try {
      const res = await setDeliveryPincode(pinToCheck);
      if (res.serviceable) {
        showToast(`Delivering to ${res.pincode} (${res.areaName})`);
        setPinModalOpen(false);
      } else {
        showToast(`PIN ${pinToCheck} is outside home delivery zone. Store Pickup available.`, 'error');
      }
    } catch {
      showToast('Unable to verify PIN code', 'error');
    } finally {
      setCheckingPin(false);
    }
  };

  const navIsActive = (prefix: string) =>
    prefix === '/' ? location.pathname === '/' : location.pathname.startsWith(prefix);

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA] text-[#202630] pb-16 lg:pb-0">
      {/* Desktop + Mobile Header */}
      <header className="sticky top-0 z-30 border-b border-[#E1E5EB] bg-white">
        {/* Top Utility Strip */}
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 h-16">
          {/* Logo + Store Name + Delivery PIN Selector */}
          <div className="flex items-center gap-4 min-w-0">
            <Link
              to="/"
              className="flex items-center gap-2.5 text-sm sm:text-base font-bold tracking-tight text-[#202630] whitespace-nowrap shrink-0"
            >
              {store?.logoUrl ? (
                <img
                  src={store.logoUrl}
                  alt={store.name}
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 rounded object-cover border border-[#E1E5EB]"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 items-center justify-center rounded bg-[#D71920] text-white font-bold text-base shrink-0"
                  title="Shree Leela Medical"
                >
                  +
                </span>
              )}
              <div className="leading-tight">
                <div className="truncate max-w-[180px] sm:max-w-[260px]">
                  {store?.name || 'Shree Leela Medical & General Stores'}
                </div>
                <div className="hidden sm:block text-[11px] font-normal text-[#526071]">
                  Mira Road East · {store?.operatingHours || '8 AM to 11 PM'}
                </div>
              </div>
            </Link>

            {/* Delivery Location & PIN Selector */}
            <button
              type="button"
              onClick={() => setPinModalOpen(true)}
              className="hidden md:flex items-center gap-1.5 rounded-md border border-[#E1E5EB] bg-[#F5F7FA] px-2.5 py-1.5 text-left hover:border-[#D71920] transition-colors cursor-pointer shrink-0"
            >
              <MapPin className="h-4 w-4 text-[#D71920] shrink-0" />
              <div className="leading-tight">
                <div className="text-[10px] font-medium text-[#526071]">
                  {deliveryLocation.serviceable ? 'Deliver to' : 'Pickup Only'}
                </div>
                <div className="flex items-center gap-1 text-xs font-semibold text-[#202630] tabular-nums">
                  <span>{deliveryLocation.pincode}</span>
                  <ChevronDown className="h-3 w-3 text-[#526071]" />
                </div>
              </div>
            </button>
          </div>

          {/* Right Header Actions: Quick Order, Upload Rx, Login/Register, My Orders, Cart */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Link
              to="/quick-order"
              className="hidden xl:inline-flex items-center gap-1.5 rounded-md border border-[#E1E5EB] px-3 py-1.5 text-xs font-medium text-[#202630] hover:border-[#D71920] hover:text-[#D71920] whitespace-nowrap shrink-0"
            >
              <Zap className="h-3.5 w-3.5 text-[#D71920]" />
              Quick Order
            </Link>

            <Link
              to="/upload-prescription"
              className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-[#16835D] bg-[#F0FDF4] px-3 py-1.5 text-xs font-semibold text-[#16835D] hover:bg-[#DCFCE7] whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Rx
            </Link>

            <Link
              to="/account/orders"
              className="hidden lg:inline-flex items-center gap-1.5 text-xs font-medium text-[#526071] hover:text-[#D71920] whitespace-nowrap shrink-0 px-1.5"
            >
              <Package className="h-4 w-4" />
              My Orders
            </Link>

            <Link
              to={user ? '/account' : '/login'}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#202630] hover:text-[#D71920] whitespace-nowrap shrink-0 px-2 py-1.5"
            >
              <User className="h-4 w-4 text-[#526071]" />
              <span>{user ? user.fullName.split(' ')[0] : 'Login / Register'}</span>
            </Link>

            <Link
              to="/cart"
              className="inline-flex items-center gap-2 rounded-md bg-[#D71920] px-3 sm:px-3.5 py-2 text-xs sm:text-sm font-medium text-white hover:bg-[#B5121B] transition-colors whitespace-nowrap shrink-0"
            >
              <ShoppingCart className="h-4 w-4" />
              <span className="tabular-nums">Cart ({cartCount})</span>
            </Link>

            <button
              type="button"
              aria-label="Toggle Menu"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#E1E5EB] text-[#202630] cursor-pointer"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile PIN + Menu Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-[#E1E5EB] bg-white px-4 py-3 space-y-2">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setPinModalOpen(true);
              }}
              className="w-full flex items-center justify-between rounded-md border border-[#E1E5EB] bg-[#F5F7FA] px-3 py-2 text-xs font-medium"
            >
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#D71920]" />
                Delivery PIN: <strong className="tabular-nums">{deliveryLocation.pincode}</strong>
              </span>
              <span className="text-[#D71920]">Change</span>
            </button>
            <Link to="/pharmacy" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">
              Pharmacy Catalog
            </Link>
            <Link to="/categories" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">
              All 13 Categories
            </Link>
            <Link to="/quick-order" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">
              Quick Order
            </Link>
            <Link to="/upload-prescription" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">
              Upload Prescription
            </Link>
            <Link to="/account/orders" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">
              My Orders & Tracking
            </Link>
            <Link to="/contact" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">
              About Store & Contact
            </Link>
            <Link to={user ? '/account' : '/login'} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium text-[#D71920]">
              {user ? `Account (${user.fullName})` : 'Login / Register'}
            </Link>
          </div>
        )}

        {/* Prominent Intelligent Search Bar (Sticky on Mobile & Desktop) */}
        {!hideSearch && (
          <div className="border-t border-[#E1E5EB] bg-[#F5F7FA] py-2.5 px-4 sm:px-6" ref={searchWrapRef}>
            <div className="mx-auto max-w-7xl relative">
              <form onSubmit={handleSearch} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex flex-1 overflow-hidden rounded-md border border-[#E1E5EB] bg-white focus-within:ring-2 focus-within:ring-[#D71920]">
                  <select
                    aria-label="Filter by category"
                    value={selectedCat}
                    onChange={(e) => setSelectedCat(e.target.value)}
                    className="hidden md:block max-w-[200px] border-r border-[#E1E5EB] bg-[#F5F7FA] px-3 text-xs font-medium text-[#3C4654] focus:outline-none"
                  >
                    <option value="">All Categories</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="search"
                    value={searchQuery}
                    onFocus={() => setDropdownOpen(true)}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setDropdownOpen(true);
                    }}
                    placeholder="Search medicine, salt, brand, strength, SKU, or barcode..."
                    className="flex-1 px-3.5 py-2 text-sm text-[#202630] placeholder:text-[#6B7686] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 bg-[#D71920] px-4 py-2 text-sm font-medium text-white hover:bg-[#B5121B] cursor-pointer"
                  >
                    <Search className="h-4 w-4" />
                    <span className="hidden sm:inline">Search</span>
                  </button>
                </div>
                <Link
                  to="/quick-order"
                  className="hidden sm:inline-flex xl:hidden items-center justify-center gap-1.5 rounded-md border border-[#E1E5EB] bg-white px-3.5 py-2 text-xs font-medium text-[#202630] hover:border-[#D71920] whitespace-nowrap shrink-0"
                >
                  <Zap className="h-3.5 w-3.5 text-[#D71920]" />
                  Quick Order
                </Link>
              </form>

              {/* Autocomplete & Recent Searches Popover */}
              {dropdownOpen && (suggestions.length > 0 || (searchQuery.trim().length < 2 && recentSearches.length > 0)) && (
                <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-md border border-[#E1E5EB] bg-white shadow-lg overflow-hidden">
                  {searchQuery.trim().length >= 2 && suggestions.length > 0 ? (
                    <div className="divide-y divide-[#E1E5EB]">
                      {suggestions.map((s) => (
                        <Link
                          key={s.id}
                          to={`/medicine/${s.slug}`}
                          onClick={() => {
                            addRecentSearch(searchQuery.trim());
                            setDropdownOpen(false);
                          }}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#F5F7FA]"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#202630] truncate">
                              {s.name}{' '}
                              {s.fuzzyMatch && (
                                <span className="ml-1 text-[11px] font-normal text-[#16835D]">(closest match)</span>
                              )}
                            </div>
                            <div className="text-xs text-[#526071] truncate">
                              {s.genericName} · {s.manufacturerName} · {s.packSize}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-[#202630] tabular-nums">
                              {formatINRPaise(s.salePricePaise)}
                            </div>
                            <div className="text-[11px] font-medium text-[#526071]">
                              {s.requiresPrescription ? 'Rx Required' : 'OTC'}
                            </div>
                          </div>
                        </Link>
                      ))}
                      <button
                        type="button"
                        onClick={handleSearch}
                        className="w-full bg-[#F5F7FA] px-4 py-2 text-left text-xs font-semibold text-[#D71920] hover:underline cursor-pointer"
                      >
                        View all results for &ldquo;{searchQuery.trim()}&rdquo; →
                      </button>
                    </div>
                  ) : (
                    recentSearches.length > 0 && (
                      <div className="p-3 space-y-2">
                        <div className="flex items-center justify-between text-xs text-[#526071]">
                          <span className="flex items-center gap-1 font-medium">
                            <History className="h-3.5 w-3.5" /> Recent Searches
                          </span>
                          <button
                            type="button"
                            onClick={clearRecentSearches}
                            className="text-[#D71920] hover:underline cursor-pointer"
                          >
                            Clear
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {recentSearches.map((term) => (
                            <button
                              key={term}
                              type="button"
                              onClick={() => {
                                setSearchQuery(term);
                                setDropdownOpen(false);
                                navigate(`/search?q=${encodeURIComponent(term)}`);
                              }}
                              className="rounded border border-[#E1E5EB] bg-[#F5F7FA] px-2.5 py-1 text-xs font-medium text-[#202630] hover:border-[#D71920] cursor-pointer"
                            >
                              {term}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Secondary Category Navigation Bar */}
        <nav
          aria-label="Pharmacy categories"
          className="border-t border-[#E1E5EB] bg-white px-4 sm:px-6"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-5 overflow-x-auto py-2 text-xs font-medium text-[#526071]">
            <Link
              to="/pharmacy"
              className="text-[#202630] font-semibold hover:text-[#D71920] whitespace-nowrap shrink-0"
            >
              All Medicines
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat.id}
                to={`/pharmacy?category=${cat.slug}`}
                className="hover:text-[#D71920] transition-colors whitespace-nowrap shrink-0"
              >
                {cat.name}
              </Link>
            ))}
            <Link
              to="/contact"
              className="ml-auto text-[#16835D] hover:underline whitespace-nowrap shrink-0"
            >
              About & Store Info
            </Link>
          </div>
        </nav>
      </header>

      {/* PIN Code Serviceability Selector Modal */}
      {pinModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-[#E1E5EB] bg-white p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E1E5EB] pb-3">
              <h2 className="text-base font-bold text-[#202630]">Delivery Location & PIN Code</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPinModalOpen(false)}
                className="p-1 text-[#526071] hover:text-[#202630] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-[#526071]">
              Check home delivery serviceability from {store?.name || 'our Hatkesh Road store'} (Mira Road East) or select Store Pickup at checkout.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter 6-digit PIN (e.g. 401107)"
                className="flex-1 rounded-md border border-[#E1E5EB] px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-[#D71920]"
              />
              <button
                type="button"
                disabled={checkingPin || pinInput.length !== 6}
                onClick={() => handleCheckPin(pinInput)}
                className="rounded-md bg-[#D71920] px-4 py-2 text-xs font-semibold text-white hover:bg-[#B5121B] disabled:opacity-50 cursor-pointer"
              >
                {checkingPin ? 'Checking...' : 'Check'}
              </button>
            </div>

            <div className={`flex items-start gap-2 rounded-md p-3 text-xs ${deliveryLocation.serviceable ? 'bg-[#ECFDF5] text-[#16835D]' : 'bg-[#FFF5F5] text-[#B5121B]'}`}>
              {deliveryLocation.serviceable ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div>
                <div className="font-semibold">
                  {deliveryLocation.serviceable
                    ? `Serviceable: ${deliveryLocation.pincode} — ${deliveryLocation.areaName}`
                    : `PIN ${deliveryLocation.pincode} outside local home delivery coverage`}
                </div>
                <div className="mt-0.5 text-[#526071]">
                  {deliveryLocation.serviceable
                    ? `Standard delivery fee ${formatINRPaise(deliveryLocation.deliveryFeePaise)} (Free above ${formatINRPaise(store?.freeDeliveryThresholdPaise ?? 49900)}).`
                    : 'Counter pickup is available at Gaurav Avenue, Hatkesh Road (8 AM – 11 PM).'}
                </div>
              </div>
            </div>

            {serviceablePincodes.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#526071]">
                  Active Neighbourhood Delivery PIN Codes
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {serviceablePincodes.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPinInput(p.pincode);
                        handleCheckPin(p.pincode);
                      }}
                      className={`rounded border px-2.5 py-1 text-xs font-medium tabular-nums cursor-pointer ${
                        deliveryLocation.pincode === p.pincode
                          ? 'border-[#D71920] bg-[#FFF5F5] text-[#D71920]'
                          : 'border-[#E1E5EB] bg-[#F5F7FA] text-[#202630]'
                      }`}
                    >
                      {p.pincode}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1">{children}</main>

      {/* Clean Pharmacy Footer */}
      <footer className="mt-14 border-t border-[#E1E5EB] bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 sm:px-6 py-10 md:grid-cols-4">
          <div className="md:col-span-2 space-y-2.5">
            <h3 className="text-base font-bold text-[#202630]">
              {store?.name || 'Shree Leela Medical & General Stores'}
            </h3>
            <p className="flex items-start gap-2 text-sm text-[#526071]">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#D71920]" />
              <span>
                {store
                  ? `${store.addressLine1}${store.landmark ? `, ${store.landmark}` : ''}, ${store.city}, ${store.state} ${store.postalCode}`
                  : 'Gaurav Avenue, near GCC Club, Hatkesh Road, Mira Road East, Maharashtra'}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-[#526071]">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-4 w-4 text-[#16835D]" />
                {store?.phone || '+91 72082 82337'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-[#526071]" />
                {store?.operatingHours || '8 AM to 11 PM'}
              </span>
            </div>
            {store?.googleMapsUrl && (
              <a
                href={store.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#D71920] hover:underline"
              >
                View Store Location on Google Maps
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#526071]">
              Online Pharmacy
            </h4>
            <ul className="space-y-2 text-sm text-[#202630]">
              <li><Link to="/pharmacy" className="hover:text-[#D71920]">Browse Medicines</Link></li>
              <li><Link to="/categories" className="hover:text-[#D71920]">Pharmacy Categories</Link></li>
              <li><Link to="/quick-order" className="hover:text-[#D71920]">Quick Order</Link></li>
              <li><Link to="/upload-prescription" className="hover:text-[#D71920]">Upload Prescription</Link></li>
              <li><Link to="/account/orders" className="hover:text-[#D71920]">My Orders & Tracking</Link></li>
              <li><Link to="/contact" className="hover:text-[#D71920]">About Store & Contact</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#526071]">
              Operations Portals
            </h4>
            <ul className="space-y-2 text-sm text-[#202630]">
              <li><Link to="/admin" className="hover:text-[#D71920]">Pharmacy Admin Dashboard</Link></li>
              <li><Link to="/delivery/dashboard" className="hover:text-[#D71920]">Delivery Partner App</Link></li>
              <li><Link to="/login" className="hover:text-[#D71920]">Customer & Staff Sign In</Link></li>
              <li><Link to="/delivery/login" className="hover:text-[#D71920]">Delivery Partner Sign In</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-[#E1E5EB] bg-[#F5F7FA] py-3 px-4 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-xs text-[#526071]">
            <span>© {new Date().getFullYear()} {store?.name || 'Shree Leela Medical & General Stores'}. Currency: INR · Asia/Kolkata</span>
            <span>{store?.drugLicenseNumber ? `Drug License: ${store.drugLicenseNumber}` : 'Pharmacy Management Platform'}</span>
          </div>
        </div>
      </footer>

      {/* Mobile-First Bottom Navigation (Home | Pharmacy | Orders | Cart | Account) */}
      <nav
        aria-label="Mobile bottom navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-[#E1E5EB] bg-white h-16"
      >
        <Link
          to="/"
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${navIsActive('/') ? 'text-[#D71920]' : 'text-[#526071]'}`}
        >
          <Home className="h-5 w-5" />
          <span>Home</span>
        </Link>
        <Link
          to="/pharmacy"
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${navIsActive('/pharmacy') || navIsActive('/categories') || navIsActive('/search') ? 'text-[#D71920]' : 'text-[#526071]'}`}
        >
          <Pill className="h-5 w-5" />
          <span>Pharmacy</span>
        </Link>
        <Link
          to="/account/orders"
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${navIsActive('/account/orders') || navIsActive('/track') ? 'text-[#D71920]' : 'text-[#526071]'}`}
        >
          <Package className="h-5 w-5" />
          <span>Orders</span>
        </Link>
        <Link
          to="/cart"
          className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${navIsActive('/cart') ? 'text-[#D71920]' : 'text-[#526071]'}`}
        >
          <ShoppingCart className="h-5 w-5" />
          <span>Cart{cartCount > 0 ? ` (${cartCount})` : ''}</span>
        </Link>
        <Link
          to={user ? '/account' : '/login'}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${navIsActive('/account') && !navIsActive('/account/orders') ? 'text-[#D71920]' : 'text-[#526071]'}`}
        >
          <User className="h-5 w-5" />
          <span>Account</span>
        </Link>
      </nav>
    </div>
  );
}
