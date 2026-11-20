import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { StorefrontLayout } from '../../components/StorefrontLayout.tsx';
import { Button, Card, Input, Label } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { Role, type AuthUserDTO } from '../../shared/types.ts';

const DEMO_TEST_ACCOUNTS = [
  { label: 'Customer (Demo)', email: 'customer.demo@shreeleela.example', pass: 'DemoPass@123', redirect: '/' },
  { label: 'Store Admin (Demo)', email: 'admin.demo@shreeleela.example', pass: 'AdminPass@123', redirect: '/admin' },
  { label: 'Pharmacist (Demo)', email: 'pharmacist.demo@shreeleela.example', pass: 'PharmaPass@123', redirect: '/admin/prescriptions' },
  { label: 'Inventory Mgr (Demo)', email: 'inventory.demo@shreeleela.example', pass: 'InvPass@123', redirect: '/admin/inventory' },
  { label: 'Delivery Partner (Demo)', email: 'delivery.demo@shreeleela.example', pass: 'RiderPass@123', redirect: '/delivery/dashboard' },
];

export function LoginPage({ isDeliveryPortal = false }: { isDeliveryPortal?: boolean }) {
  const { refreshUser, refreshCart, showToast } = useApp();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [previewResetToken, setPreviewResetToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectParam = searchParams.get('redirect');

  const routeAfterLogin = (user: AuthUserDTO | null, explicitRedirect?: string) => {
    if (explicitRedirect) {
      navigate(explicitRedirect);
      return;
    }
    if (redirectParam) {
      navigate(redirectParam);
      return;
    }
    if (isDeliveryPortal || user?.roles.includes(Role.DELIVERY_PARTNER)) {
      navigate('/delivery/dashboard');
      return;
    }
    const staffRoles: Role[] = [Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.PHARMACIST, Role.INVENTORY_MANAGER];
    if (user?.roles.some((r) => staffRoles.includes(r))) {
      navigate('/admin');
      return;
    }
    navigate('/');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const data = await apiFetch<{ user: AuthUserDTO }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, rememberMe }),
      });
      await refreshUser();
      await refreshCart();
      showToast(`Signed in as ${data.user.fullName}`);
      routeAfterLogin(data.user);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Login failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickDemoLogin = async (acc: (typeof DEMO_TEST_ACCOUNTS)[number]) => {
    setSubmitting(true);
    try {
      const data = await apiFetch<{ user: AuthUserDTO }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: acc.email, password: acc.pass, rememberMe: true }),
      });
      await refreshUser();
      await refreshCart();
      showToast(`Signed in: ${acc.label}`);
      routeAfterLogin(data.user, acc.redirect);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Login failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const data = await apiFetch<{ resetPreviewToken?: string; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (data.resetPreviewToken) {
        setPreviewResetToken(data.resetPreviewToken);
        setResetToken(data.resetPreviewToken);
      }
      showToast('Password reset token generated');
      setMode('reset');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Request failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      showToast('Password updated. Please sign in.');
      setMode('login');
      setPreviewResetToken(null);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Reset failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StorefrontLayout hideSearch>
      <div className="mx-auto max-w-md px-4 py-10 space-y-6">
        <Card className="p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-[#202630]">
              {isDeliveryPortal
                ? 'Delivery Partner Sign In'
                : mode === 'forgot'
                  ? 'Forgot Password'
                  : mode === 'reset'
                    ? 'Reset Password'
                    : 'Sign In'}
            </h1>
            <p className="mt-1 text-xs text-[#526071]">
              {isDeliveryPortal
                ? 'Sign in with your assigned Shree Leela delivery partner account.'
                : 'Access your orders, prescriptions, or store staff dashboard.'}
            </p>
          </div>

          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="login-email">Email Address</Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-[#526071]">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="accent-[#D71920]"
                  />
                  Remember me for 30 days
                </label>
                <button
                  type="button"
                  onClick={() => setMode('forgot')}
                  className="font-medium text-[#D71920] hover:underline cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <Button type="submit" disabled={submitting} className="w-full" size="lg">
                {submitting ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div>
                <Label htmlFor="forgot-email">Account Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                Generate Reset Token
              </Button>
              <button
                type="button"
                onClick={() => setMode('login')}
                className="w-full text-center text-xs text-[#526071] hover:underline cursor-pointer"
              >
                Back to Sign In
              </button>
            </form>
          )}

          {mode === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4">
              {previewResetToken && (
                <div className="rounded bg-[#F5F7FA] border border-[#E1E5EB] p-3 text-xs font-mono break-all">
                  Demo Reset Token: {previewResetToken}
                </div>
              )}
              <div>
                <Label>Reset Token</Label>
                <Input required value={resetToken} onChange={(e) => setResetToken(e.target.value)} />
              </div>
              <div>
                <Label>New Password (min 8 chars)</Label>
                <Input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                Reset Password
              </Button>
            </form>
          )}

          {!isDeliveryPortal && mode === 'login' && (
            <div className="border-t border-[#E1E5EB] pt-4 text-center text-xs text-[#526071]">
              New customer at Shree Leela Medical?{' '}
              <Link to="/register" className="font-semibold text-[#D71920] hover:underline">
                Create Customer Account
              </Link>
            </div>
          )}
        </Card>

        {/* Collapsible Demo Test User Helper */}
        <details className="rounded-lg border border-[#E1E5EB] bg-white p-4 text-xs">
          <summary className="cursor-pointer font-semibold text-[#202630]">
            Demonstration Test Accounts (All 3 Panels)
          </summary>
          <p className="mt-1.5 text-[#526071]">
            One-click sign-in for testing Customer, Store Admin, Pharmacist, Inventory, and Delivery Partner roles:
          </p>
          <div className="mt-3 space-y-2">
            {DEMO_TEST_ACCOUNTS.map((acc) => (
              <div key={acc.email} className="flex items-center justify-between gap-2 rounded border border-[#E1E5EB] p-2">
                <div className="min-w-0">
                  <div className="font-semibold text-[#202630]">{acc.label}</div>
                  <div className="truncate font-mono text-[11px] text-[#526071]">{acc.email}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleQuickDemoLogin(acc)}>
                  Sign In
                </Button>
              </div>
            ))}
          </div>
        </details>
      </div>
    </StorefrontLayout>
  );
}

export function RegisterPage() {
  const { refreshUser, refreshCart, showToast } = useApp();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch<{ verificationPreviewToken?: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, phone, password, rememberMe }),
      });
      await refreshUser();
      await refreshCart();
      showToast('Account registered. You can verify your email under Account Settings.');
      if (res.verificationPreviewToken) {
        sessionStorage.setItem('slm_verify_token', res.verificationPreviewToken);
      }
      navigate(searchParams.get('redirect') || '/account');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Registration failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StorefrontLayout hideSearch>
      <div className="mx-auto max-w-md px-4 py-10">
        <Card className="p-6 space-y-5">
          <div>
            <h1 className="text-xl font-bold text-[#202630]">Customer Registration</h1>
            <p className="mt-1 text-xs text-[#526071]">
              Create your customer account to order medicines and upload prescriptions. Staff accounts are provisioned by administrators.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="reg-name">Full Name</Label>
              <Input id="reg-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="reg-email">Email Address</Label>
              <Input id="reg-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="reg-phone">Phone Number</Label>
              <Input id="reg-phone" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98200 00000" />
            </div>
            <div>
              <Label htmlFor="reg-pass">Password (min 8 characters)</Label>
              <Input id="reg-pass" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-xs text-[#526071] cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="accent-[#D71920]"
              />
              Keep me signed in
            </label>
            <Button type="submit" disabled={submitting} className="w-full" size="lg">
              {submitting ? 'Creating Account...' : 'Register Account'}
            </Button>
          </form>

          <div className="border-t border-[#E1E5EB] pt-4 text-center text-xs text-[#526071]">
            Already registered?{' '}
            <Link to="/login" className="font-semibold text-[#D71920] hover:underline">
              Sign In
            </Link>
          </div>
        </Card>
      </div>
    </StorefrontLayout>
  );
}
