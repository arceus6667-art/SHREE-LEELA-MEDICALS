import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  ClipboardList,
  IndianRupee,
  History,
  UserCircle,
  LogOut,
  WifiOff,
  Phone,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';
import { PWAInstallButton } from './PWAInstallButton.tsx';
import { Button } from './ui/primitives.tsx';
import { Role } from '../shared/types.ts';

const DELIVERY_TABS = [
  { to: '/delivery/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/delivery/assignments', label: 'Orders', icon: ClipboardList },
  { to: '/delivery/cash', label: 'COD Cash', icon: IndianRupee },
  { to: '/delivery/history', label: 'History', icon: History },
  { to: '/delivery/profile', label: 'Profile', icon: UserCircle },
];

export function DeliveryLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { user, store, logout, loading } = useApp();
  const isOnline = useOnlineStatus();
  const location = useLocation();
  const navigate = useNavigate();

  const allowedRoles: Role[] = [Role.DELIVERY_PARTNER, Role.STORE_ADMIN, Role.SUPER_ADMIN];
  const allowed = user?.roles.some((r) => allowedRoles.includes(r));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] text-sm text-[#526071]">
        Loading delivery partner app...
      </div>
    );
  }

  if (!user || !allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] p-6">
        <div className="max-w-md w-full rounded-lg border border-[#E1E5EB] bg-white p-6 space-y-4">
          <h1 className="text-lg font-bold text-[#202630]">Delivery Partner Sign In Required</h1>
          <p className="text-sm text-[#526071]">
            Sign in with your assigned delivery partner credentials for{' '}
            {store?.name || 'Shree Leela Medical & General Stores'}.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/delivery/login')}>Delivery Sign In</Button>
            <Button variant="outline" onClick={() => navigate('/')}>Storefront</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA] text-[#202630] pb-20 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-[#E1E5EB] bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-3 sm:px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#16835D] text-white font-bold text-xs">
              SLM
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-[#202630]">{title}</div>
              <div className="truncate text-[11px] text-[#526071]">
                {store?.name || 'Shree Leela Medical'} · Rider PWA
              </div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {DELIVERY_TABS.map((t) => {
              const Icon = t.icon;
              const active = location.pathname.startsWith(t.to);
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium whitespace-nowrap ${
                    active ? 'bg-[#F0FDF4] text-[#16835D]' : 'text-[#526071] hover:text-[#202630]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{t.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5 shrink-0">
            <PWAInstallButton />
            {store?.phone && (
              <a
                href={`tel:${store.phone}`}
                aria-label="Call pharmacy dispatch"
                className="inline-flex h-9 min-w-[36px] items-center justify-center gap-1 rounded-md border border-[#E1E5EB] px-2.5 text-xs font-medium text-[#202630] hover:bg-[#F5F7FA]"
              >
                <Phone className="h-3.5 w-3.5 text-[#16835D]" />
                <span className="hidden sm:inline">Support</span>
              </a>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-9 min-w-[36px]"
              onClick={async () => {
                await logout();
                navigate('/delivery/login');
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>

        {!isOnline && (
          <div className="flex items-center justify-center gap-2 bg-[#FEF3C7] border-t border-[#FDE68A] px-3 py-1.5 text-xs font-medium text-[#92400E]">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            <span>Offline mode — current assignment cached; status updates will queue for sync.</span>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-3 sm:p-6">{children}</main>

      {/* Mobile Bottom Tab Bar (Thumb-Zone >= 44px Hitboxes) */}
      <nav
        aria-label="Delivery navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-[#E1E5EB] bg-white h-16"
      >
        {DELIVERY_TABS.map((t) => {
          const Icon = t.icon;
          const active = location.pathname.startsWith(t.to);
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`flex flex-col items-center justify-center gap-0.5 min-h-[44px] text-[11px] font-medium ${
                active ? 'text-[#16835D]' : 'text-[#526071]'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
