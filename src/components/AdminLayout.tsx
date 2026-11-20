import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingBag,
  Boxes,
  Pill,
  FolderTree,
  FileCheck2,
  Users,
  Bike,
  MapPinned,
  CreditCard,
  BarChart3,
  Settings,
  LogOut,
  ExternalLink,
  Upload,
  Truck,
  Globe,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Rocket,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { Button } from './ui/primitives.tsx';
import { Role } from '../shared/types.ts';

interface NavGroup {
  label: string;
  items: Array<{
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/admin', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/admin/orders', label: 'Orders', icon: ShoppingBag },
      { to: '/admin/prescriptions', label: 'Prescription review', icon: FileCheck2 },
      { to: '/admin/live-tracking', label: 'Live tracking', icon: MapPinned },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { to: '/admin/inventory', label: 'Batch Inventory', icon: Boxes },
      { to: '/admin/bulk-import', label: 'Bulk Import / Export', icon: Upload },
      { to: '/admin/medicines', label: 'Medicines', icon: Pill },
      { to: '/admin/categories', label: 'Categories', icon: FolderTree },
      { to: '/admin/suppliers', label: 'Suppliers & POs', icon: Truck },
    ],
  },
  {
    label: 'Commerce & Fleet',
    items: [
      { to: '/admin/customers', label: 'Customers', icon: Users },
      { to: '/admin/delivery-partners', label: 'Delivery Partners', icon: Bike },
      { to: '/admin/payments', label: 'Payments & COD', icon: CreditCard },
      { to: '/admin/content', label: 'Website Content', icon: Globe },
    ],
  },
  {
    label: 'Store administration',
    items: [
      { to: '/admin/onboarding', label: 'Launch Onboarding', icon: Rocket },
      { to: '/admin/reports', label: 'Reports & Exports', icon: BarChart3 },
      { to: '/admin/audit', label: 'Staff access and audit', icon: ShieldCheck },
      { to: '/admin/settings', label: 'Store Settings', icon: Settings },
    ],
  },
];

const STAFF_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.STORE_ADMIN,
  Role.PHARMACIST,
  Role.INVENTORY_MANAGER,
];

export function AdminLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { user, store, logout, loading } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('slm_admin_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('slm_admin_sidebar_collapsed', next ? '1' : '0');
    } catch {
      // ignore storage errors
    }
  };

  const isStaff = user?.roles.some((r) => STAFF_ROLES.includes(r));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] text-sm text-[#526071]">
        Loading pharmacy administration workspace...
      </div>
    );
  }

  if (!user || !isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F7FA] p-6">
        <div className="max-w-md w-full rounded-lg border border-[#E1E5EB] bg-white p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded bg-[#D71920] text-white font-bold">+</span>
            <div>
              <h1 className="text-lg font-bold text-[#202630]">Pharmacy Admin Access Required</h1>
              <p className="text-xs text-[#526071]">{store?.name || 'Shree Leela Medical & General Stores'}</p>
            </div>
          </div>
          <p className="text-sm text-[#526071]">
            Please sign in with an authorized Store Admin, Registered Pharmacist, Inventory Manager, or Super Admin account.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate('/login?redirect=/admin')}>Sign In as Staff</Button>
            <Button variant="outline" onClick={() => navigate('/')}>Back to Storefront</Button>
          </div>
        </div>
      </div>
    );
  }

  const isActivePath = (to: string) =>
    to === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(to);

  return (
    <div className="min-h-screen flex bg-[#F5F7FA] text-[#202630]">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden md:flex md:sticky md:top-0 md:h-dvh shrink-0 flex-col border-r border-[#E1E5EB] bg-white transition-all duration-200 ${
          collapsed ? 'w-[68px]' : 'w-64'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-[#E1E5EB] px-3.5">
          <Link to="/admin" className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#D71920] text-white font-bold text-sm">
              +
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[#202630]">Shree Leela Medical</div>
                <div className="truncate text-[11px] text-[#526071]">{store?.code || 'SLM-MIRA-01'}</div>
              </div>
            )}
          </Link>
          <button
            type="button"
            onClick={toggleSidebar}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded p-1.5 text-[#526071] hover:bg-[#F5F7FA] hover:text-[#202630] cursor-pointer"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7686]">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActivePath(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-[#FFF5F5] text-[#D71920]'
                          : 'text-[#526071] hover:bg-[#F5F7FA] hover:text-[#202630]'
                      } ${collapsed ? 'justify-center' : ''}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[#E1E5EB] p-2.5 space-y-1.5">
          <Link
            to="/"
            title="Customer Storefront"
            className={`flex items-center rounded-md border border-[#E1E5EB] px-2.5 py-2 text-xs font-medium text-[#202630] hover:bg-[#F5F7FA] ${
              collapsed ? 'justify-center' : 'justify-between'
            }`}
          >
            {!collapsed && <span>Customer Storefront</span>}
            <ExternalLink className="h-3.5 w-3.5 text-[#526071]" />
          </Link>
          <Link
            to="/delivery/dashboard"
            title="Delivery Partner App"
            className={`flex items-center rounded-md border border-[#E1E5EB] px-2.5 py-2 text-xs font-medium text-[#202630] hover:bg-[#F5F7FA] ${
              collapsed ? 'justify-center' : 'justify-between'
            }`}
          >
            {!collapsed && <span>Delivery App</span>}
            <ExternalLink className="h-3.5 w-3.5 text-[#526071]" />
          </Link>
        </div>
      </aside>

      {/* Mobile Slide-Over Navigation */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-10 flex w-72 flex-col bg-white border-r border-[#E1E5EB]">
            <div className="flex h-14 items-center justify-between border-b border-[#E1E5EB] px-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded bg-[#D71920] text-white font-bold text-xs">+</span>
                <span className="text-sm font-bold">Shree Leela Medical</span>
              </div>
              <button type="button" onClick={() => setMobileOpen(false)} className="p-1 text-[#526071]">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-4">
              {NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7686]">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActivePath(item.to);
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setMobileOpen(false)}
                          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
                            active ? 'bg-[#FFF5F5] text-[#D71920]' : 'text-[#526071]'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-[#E1E5EB] bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden rounded p-1.5 border border-[#E1E5EB] text-[#202630]"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <span className="text-xs font-medium text-[#526071] hidden sm:inline">Store management</span>
            <span className="text-xs text-[#CBD2D9] hidden sm:inline">/</span>
            <h1 className="truncate text-base sm:text-lg font-bold text-[#202630]">{title}</h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-semibold text-[#202630]">{user.fullName}</div>
              <div className="text-[11px] text-[#526071]">{user.roles.join(', ')}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
