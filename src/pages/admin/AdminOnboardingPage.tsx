import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  DatabaseBackup,
  ShieldCheck,
  Rocket,
  BellRing,
  Lock,
} from 'lucide-react';
import { AdminLayout } from '../../components/AdminLayout.tsx';
import { Button, Card, Input, Label } from '../../components/ui/primitives.tsx';
import { useApp } from '../../context/AppContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import {
  formatIndianDateTime,
  type OnboardingStateDTO,
  type PublicStoreInfo,
} from '../../shared/types.ts';

interface NotificationLogRow {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  channel: string;
  template: string;
  title: string;
  body: string;
  status: string;
  provider_message_id: string | null;
  created_at: string;
}

export function AdminOnboardingPage() {
  const { showToast, refreshStore } = useApp();
  const [onboarding, setOnboarding] = useState<OnboardingStateDTO | null>(null);
  const [store, setStore] = useState<PublicStoreInfo | null>(null);
  const [notifLogs, setNotifLogs] = useState<NotificationLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningBackup, setRunningBackup] = useState(false);
  const [lastBackup, setLastBackup] = useState<{ filename: string; sizeBytes: number; createdAt: string } | null>(null);

  // Quick compliance metadata editor
  const [drugLicenseNumber, setDrugLicenseNumber] = useState('');
  const [gstin, setGstin] = useState('');
  const [pharmacistName, setPharmacistName] = useState('');
  const [pharmacistRegNumber, setPharmacistRegNumber] = useState('');

  const load = async () => {
    try {
      const [obRes, logsRes] = await Promise.all([
        apiFetch<{ onboarding: OnboardingStateDTO; store: PublicStoreInfo }>('/api/admin/onboarding'),
        apiFetch<{ logs: NotificationLogRow[] }>('/api/admin/notifications/logs'),
      ]);
      setOnboarding(obRes.onboarding);
      setStore(obRes.store);
      setDrugLicenseNumber(obRes.store.drugLicenseNumber || '');
      setGstin(obRes.store.gstin || '');
      setPharmacistName(obRes.store.pharmacistName || '');
      setPharmacistRegNumber(obRes.store.pharmacistRegNumber || '');
      setNotifLogs(logsRes.logs || []);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unable to load onboarding checklist', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggleStep = async (stepKey: string, completed: boolean) => {
    try {
      const res = await apiFetch<{ onboarding: OnboardingStateDTO; store: PublicStoreInfo }>(
        '/api/admin/onboarding/step',
        {
          method: 'PATCH',
          body: JSON.stringify({ stepKey, completed }),
        }
      );
      setOnboarding(res.onboarding);
      setStore(res.store);
      showToast(`Onboarding step updated`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleSaveLicenses = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ onboarding: OnboardingStateDTO; store: PublicStoreInfo }>(
        '/api/admin/onboarding/step',
        {
          method: 'PATCH',
          body: JSON.stringify({
            stepKey: 'DRUG_LICENSE_GST',
            completed: true,
            details: {
              drugLicenseNumber,
              gstin,
              pharmacistName,
              pharmacistRegNumber,
            },
          }),
        }
      );
      setOnboarding(res.onboarding);
      setStore(res.store);
      await refreshStore();
      showToast('Regulatory licenses & Pharmacist details saved');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to save licenses', 'error');
    }
  };

  const handleLaunchSignOff = async (enableProductionSales: boolean) => {
    try {
      const res = await apiFetch<{ onboarding: OnboardingStateDTO; store: PublicStoreInfo }>(
        '/api/admin/onboarding/launch',
        {
          method: 'POST',
          body: JSON.stringify({ enableProductionSales }),
        }
      );
      setOnboarding(res.onboarding);
      setStore(res.store);
      await refreshStore();
      showToast(
        enableProductionSales
          ? 'Production sales sign-off enabled'
          : 'Store returned to pre-launch validation mode'
      );
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Cannot enable production sales yet', 'error');
    }
  };

  const handleRunBackup = async () => {
    setRunningBackup(true);
    try {
      const res = await apiFetch<{ backup: { filename: string; sizeBytes: number; createdAt: string } }>(
        '/api/admin/backups/run',
        { method: 'POST' }
      );
      setLastBackup(res.backup);
      showToast(`Backup created: ${res.backup.filename}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Backup failed', 'error');
    } finally {
      setRunningBackup(false);
    }
  };

  const completedCount = onboarding?.steps.filter((s) => s.completed).length || 0;
  const totalSteps = onboarding?.steps.length || 7;

  return (
    <AdminLayout title="Store Owner Onboarding & Launch Gate">
      {loading ? (
        <div className="h-64 rounded-lg border border-[#E1E5EB] bg-white animate-pulse" />
      ) : (
        <div className="space-y-6">
          {/* Launch Gate Status Banner */}
          <Card className="p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {onboarding?.productionSalesEnabled ? (
                  <Rocket className="h-5 w-5 text-[#16835D]" />
                ) : (
                  <Lock className="h-5 w-5 text-[#D97706]" />
                )}
                <h2 className="text-base font-bold text-[#202630]">
                  {onboarding?.productionSalesEnabled
                    ? 'Production Sales Approved & Ready'
                    : 'Pre-Launch Sandbox Guard Active (Demo Inventory Mode)'}
                </h2>
              </div>
              <p className="text-xs text-[#526071]">
                {onboarding?.productionSalesEnabled
                  ? `Owner compliance sign-off recorded${onboarding.approvedAt ? ` on ${formatIndianDateTime(onboarding.approvedAt)}` : ''}. Ensure live Razorpay keys are configured in environment secrets before switching to real billing.`
                  : 'Production live-payment mode remains locked until all 7 pharmacy regulatory, pharmacist credential, catalog, and test-order checks are verified.'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-xs">
                <div className="font-bold tabular-nums text-[#202630]">
                  {completedCount} / {totalSteps} Steps Verified
                </div>
                <div className="text-[#526071]">Store: {store?.code}</div>
              </div>
              {onboarding?.productionSalesEnabled ? (
                <Button variant="outline" size="sm" onClick={() => handleLaunchSignOff(false)}>
                  Lock Sandbox Mode
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={completedCount < totalSteps}
                  onClick={() => handleLaunchSignOff(true)}
                >
                  Approve Production Launch
                </Button>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* 7-Step Onboarding Checklist */}
            <Card className="lg:col-span-7 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-[#E1E5EB] pb-3">
                <h3 className="text-sm font-bold text-[#202630] flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#16835D]" />
                  <span>7-Step Store Launch &amp; Pharmacy Compliance Checklist</span>
                </h3>
              </div>
              <div className="divide-y divide-[#E1E5EB]">
                {(onboarding?.steps || []).map((step, idx) => (
                  <div key={step.key} className="py-3 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      {step.completed ? (
                        <CheckCircle2 className="h-5 w-5 text-[#16835D] shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="h-5 w-5 text-[#CBD2D9] shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="text-xs font-bold text-[#202630]">
                          Step {idx + 1}: {step.title}
                        </div>
                        <p className="text-xs text-[#526071] mt-0.5">{step.description}</p>
                        {step.completedAt && (
                          <div className="text-[11px] text-[#16835D] mt-0.5 tabular-nums">
                            Verified {formatIndianDateTime(step.completedAt)}
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={step.completed ? 'outline' : 'secondary'}
                      onClick={() => handleToggleStep(step.key, !step.completed)}
                    >
                      {step.completed ? 'Undo' : 'Mark Verified'}
                    </Button>
                  </div>
                ))}
              </div>
            </Card>

            {/* Statutory Details + SQLite Backup Trigger */}
            <div className="lg:col-span-5 space-y-6">
              <Card className="p-5 space-y-4">
                <h3 className="text-sm font-bold text-[#202630] border-b border-[#E1E5EB] pb-2">
                  Statutory Drug License, GSTIN &amp; Pharmacist Credentials
                </h3>
                <form onSubmit={handleSaveLicenses} className="space-y-3 text-xs">
                  <div>
                    <Label>Drug License Numbers (Form 20 / 21)</Label>
                    <Input
                      required
                      value={drugLicenseNumber}
                      onChange={(e) => setDrugLicenseNumber(e.target.value)}
                      placeholder="e.g., MH-MZ4-20/21-104921"
                    />
                  </div>
                  <div>
                    <Label>Store GSTIN</Label>
                    <Input
                      required
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value)}
                      placeholder="e.g., 27AABCS1429B1Z5"
                    />
                  </div>
                  <div>
                    <Label>Supervising Registered Pharmacist Name</Label>
                    <Input
                      required
                      value={pharmacistName}
                      onChange={(e) => setPharmacistName(e.target.value)}
                      placeholder="e.g., RPh Ananya Deshmukh"
                    />
                  </div>
                  <div>
                    <Label>State Pharmacy Council Registration #</Label>
                    <Input
                      required
                      value={pharmacistRegNumber}
                      onChange={(e) => setPharmacistRegNumber(e.target.value)}
                      placeholder="e.g., MSPC-44821"
                    />
                  </div>
                  <Button type="submit" size="sm">
                    Save &amp; Verify Regulatory Credentials
                  </Button>
                </form>
              </Card>

              <Card className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#202630] flex items-center gap-2">
                    <DatabaseBackup className="h-4 w-4 text-[#D71920]" />
                    <span>SQLite Hot Backup (VACUUM INTO)</span>
                  </h3>
                  <Button size="sm" variant="outline" disabled={runningBackup} onClick={handleRunBackup}>
                    {runningBackup ? 'Creating...' : 'Run Backup Now'}
                  </Button>
                </div>
                <p className="text-xs text-[#526071]">
                  Creates an atomic, WAL-consistent snapshot of all pharmacy orders, prescriptions, batches, and audit logs into the server backups directory.
                </p>
                {lastBackup && (
                  <div className="rounded border border-[#A7F3D0] bg-[#ECFDF5] p-3 text-xs text-[#16835D] space-y-0.5">
                    <div className="font-semibold">Latest Snapshot: {lastBackup.filename}</div>
                    <div className="tabular-nums">
                      Size: {Math.round(lastBackup.sizeBytes / 1024)} KB · {formatIndianDateTime(lastBackup.createdAt)}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* Centralized Notification Delivery Audit Logs */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-[#E1E5EB] pb-2">
              <h3 className="text-sm font-bold text-[#202630] flex items-center gap-2">
                <BellRing className="h-4 w-4 text-[#D71920]" />
                <span>Centralized Notification Dispatch Logs ({notifLogs.length})</span>
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#E1E5EB] text-left text-[#526071]">
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 font-medium">Recipient</th>
                    <th className="py-2 pr-3 font-medium">Channel</th>
                    <th className="py-2 pr-3 font-medium">Template</th>
                    <th className="py-2 pr-3 font-medium">Message</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1E5EB]">
                  {notifLogs.slice(0, 20).map((n) => (
                    <tr key={n.id}>
                      <td className="py-2 pr-3 text-[#526071] tabular-nums whitespace-nowrap">
                        {formatIndianDateTime(n.created_at)}
                      </td>
                      <td className="py-2 pr-3 font-medium">{n.user_name || 'System'}</td>
                      <td className="py-2 pr-3 font-mono">{n.channel}</td>
                      <td className="py-2 pr-3 font-mono">{n.template}</td>
                      <td className="py-2 pr-3 text-[#526071] max-w-md truncate">{n.title}</td>
                      <td className="py-2 font-semibold text-[#16835D]">{n.status}</td>
                    </tr>
                  ))}
                  {notifLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[#526071]">
                        No notifications dispatched yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}
