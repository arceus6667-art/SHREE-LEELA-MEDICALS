import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import type { AuthUserDTO, CartDTO, CategoryDTO, PublicStoreInfo, ServiceablePincodeDTO } from '../shared/types.ts';

export interface DeliveryLocationState {
  pincode: string;
  areaName: string | null;
  serviceable: boolean;
  deliveryFeePaise: number;
  estimatedMins: number | null;
}

interface AppContextValue {
  store: PublicStoreInfo | null;
  user: AuthUserDTO | null;
  cart: CartDTO | null;
  categories: CategoryDTO[];
  serviceablePincodes: ServiceablePincodeDTO[];
  deliveryLocation: DeliveryLocationState;
  recentSearches: string[];
  recentlyViewedIds: string[];
  loading: boolean;
  toast: { message: string; tone: 'success' | 'error' } | null;
  showToast: (message: string, tone?: 'success' | 'error') => void;
  refreshStore: () => Promise<void>;
  refreshUser: () => Promise<AuthUserDTO | null>;
  refreshCart: () => Promise<void>;
  setDeliveryPincode: (pincode: string) => Promise<DeliveryLocationState>;
  addRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
  recordRecentlyViewed: (medicineId: string) => void;
  addToCart: (medicineId: string, quantity?: number) => Promise<void>;
  updateCartQty: (medicineId: string, quantity: number) => Promise<void>;
  removeFromCart: (medicineId: string) => Promise<void>;
  saveForLater: (medicineId: string) => Promise<void>;
  moveToCart: (medicineId: string) => Promise<void>;
  reorderOrder: (orderId: string) => Promise<{ added: string[]; skipped: string[] }>;
  logout: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const PIN_STORAGE_KEY = 'slm_delivery_pincode';
const RECENT_SEARCH_KEY = 'slm_recent_searches';
const RECENT_VIEWED_KEY = 'slm_recently_viewed';

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<PublicStoreInfo | null>(null);
  const [user, setUser] = useState<AuthUserDTO | null>(null);
  const [cart, setCart] = useState<CartDTO | null>(null);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [serviceablePincodes, setServiceablePincodes] = useState<ServiceablePincodeDTO[]>([]);
  const [deliveryLocation, setDeliveryLocation] = useState<DeliveryLocationState>({
    pincode: localStorage.getItem(PIN_STORAGE_KEY) || '401107',
    areaName: 'Mira Road East (Gaurav Avenue / Hatkesh / Beverly Park)',
    serviceable: true,
    deliveryFeePaise: 2500,
    estimatedMins: 35,
  });
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_SEARCH_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_VIEWED_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  }, []);

  const refreshStore = useCallback(async () => {
    const data = await apiFetch<PublicStoreInfo>('/api/store/public');
    setStore(data);
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await apiFetch<{ user: AuthUserDTO | null }>('/api/auth/me');
    setUser(data.user);
    return data.user;
  }, []);

  const refreshCart = useCallback(async () => {
    const data = await apiFetch<CartDTO>('/api/cart');
    setCart(data);
  }, []);

  const setDeliveryPincode = useCallback(async (pincode: string) => {
    const clean = pincode.trim();
    const res = await apiFetch<{
      serviceable: boolean;
      pincode: string;
      areaName: string | null;
      deliveryFeePaise: number;
      estimatedMins: number | null;
      allPincodes: ServiceablePincodeDTO[];
    }>(`/api/store/serviceability?pincode=${encodeURIComponent(clean)}`);

    const next: DeliveryLocationState = {
      pincode: res.pincode || clean,
      areaName: res.areaName,
      serviceable: res.serviceable,
      deliveryFeePaise: res.deliveryFeePaise,
      estimatedMins: res.estimatedMins,
    };
    setDeliveryLocation(next);
    setServiceablePincodes(res.allPincodes);
    localStorage.setItem(PIN_STORAGE_KEY, next.pincode);
    return next;
  }, []);

  useEffect(() => {
    const savedPin = localStorage.getItem(PIN_STORAGE_KEY) || '401107';
    (async () => {
      try {
        const [storeData, authData, cartData, catData, serviceData] = await Promise.all([
          apiFetch<PublicStoreInfo>('/api/store/public'),
          apiFetch<{ user: AuthUserDTO | null }>('/api/auth/me'),
          apiFetch<CartDTO>('/api/cart'),
          apiFetch<{ categories: CategoryDTO[] }>('/api/catalog/categories'),
          apiFetch<{
            serviceable: boolean;
            pincode: string;
            areaName: string | null;
            deliveryFeePaise: number;
            estimatedMins: number | null;
            allPincodes: ServiceablePincodeDTO[];
          }>(`/api/store/serviceability?pincode=${encodeURIComponent(savedPin)}`),
        ]);
        setStore(storeData);
        setUser(authData.user);
        setCart(cartData);
        setCategories(catData.categories);
        setServiceablePincodes(serviceData.allPincodes);
        setDeliveryLocation({
          pincode: serviceData.pincode || savedPin,
          areaName: serviceData.areaName,
          serviceable: serviceData.serviceable,
          deliveryFeePaise: serviceData.deliveryFeePaise,
          estimatedMins: serviceData.estimatedMins,
        });
      } catch (err) {
        console.error('Initial bootstrap error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const addRecentSearch = useCallback((q: string) => {
    const clean = q.trim();
    if (!clean) return;
    setRecentSearches((prev) => {
      const next = [clean, ...prev.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 6);
      localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    localStorage.removeItem(RECENT_SEARCH_KEY);
  }, []);

  const recordRecentlyViewed = useCallback((medicineId: string) => {
    if (!medicineId) return;
    setRecentlyViewedIds((prev) => {
      const next = [medicineId, ...prev.filter((x) => x !== medicineId)].slice(0, 8);
      localStorage.setItem(RECENT_VIEWED_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const addToCart = useCallback(
    async (medicineId: string, quantity = 1) => {
      try {
        const updated = await apiFetch<CartDTO>('/api/cart/items', {
          method: 'POST',
          body: JSON.stringify({ medicineId, quantity }),
        });
        setCart(updated);
        showToast('Added to cart');
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Unable to add item', 'error');
      }
    },
    [showToast]
  );

  const updateCartQty = useCallback(
    async (medicineId: string, quantity: number) => {
      try {
        const updated = await apiFetch<CartDTO>(`/api/cart/items/${medicineId}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity }),
        });
        setCart(updated);
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Unable to update cart', 'error');
      }
    },
    [showToast]
  );

  const removeFromCart = useCallback(
    async (medicineId: string) => {
      try {
        const updated = await apiFetch<CartDTO>(`/api/cart/items/${medicineId}`, {
          method: 'DELETE',
        });
        setCart(updated);
        showToast('Removed from cart');
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Unable to remove item', 'error');
      }
    },
    [showToast]
  );

  const saveForLater = useCallback(
    async (medicineId: string) => {
      try {
        const updated = await apiFetch<CartDTO>(`/api/cart/save-for-later/${medicineId}`, {
          method: 'POST',
        });
        setCart(updated);
        showToast('Saved for later');
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Unable to save item', 'error');
      }
    },
    [showToast]
  );

  const moveToCart = useCallback(
    async (medicineId: string) => {
      try {
        const updated = await apiFetch<CartDTO>(`/api/cart/move-to-cart/${medicineId}`, {
          method: 'POST',
        });
        setCart(updated);
        showToast('Moved to cart');
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Unable to move item to cart', 'error');
      }
    },
    [showToast]
  );

  const reorderOrder = useCallback(
    async (orderId: string) => {
      const res = await apiFetch<{ cart: CartDTO; added: string[]; skipped: string[] }>(
        `/api/orders/${orderId}/reorder`,
        { method: 'POST' }
      );
      setCart(res.cart);
      if (res.added.length > 0) {
        showToast(`Added ${res.added.length} item(s) to cart`);
      } else {
        showToast('No items from that order are currently available', 'error');
      }
      return { added: res.added, skipped: res.skipped };
    },
    [showToast]
  );

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    await refreshCart();
    showToast('Signed out');
  }, [refreshCart, showToast]);

  return (
    <AppContext.Provider
      value={{
        store,
        user,
        cart,
        categories,
        serviceablePincodes,
        deliveryLocation,
        recentSearches,
        recentlyViewedIds,
        loading,
        toast,
        showToast,
        refreshStore,
        refreshUser,
        refreshCart,
        setDeliveryPincode,
        addRecentSearch,
        clearRecentSearches,
        recordRecentlyViewed,
        addToCart,
        updateCartQty,
        removeFromCart,
        saveForLater,
        moveToCart,
        reorderOrder,
        logout,
      }}
    >
      {children}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-20 lg:bottom-5 right-5 z-50 rounded-md px-4 py-2.5 text-sm font-medium text-white shadow-md ${
            toast.tone === 'error' ? 'bg-[#B5121B]' : 'bg-[#16835D]'
          }`}
        >
          {toast.message}
        </div>
      )}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return ctx;
}
