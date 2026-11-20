import { sqlite, databaseService } from '../db/sqlite-db.ts';
import type { OnboardingStateDTO, OnboardingStepDTO } from '../../shared/types.ts';

export function isScheduleBlockedOnline(scheduleType: string): boolean {
  const norm = (scheduleType || '').trim().toUpperCase();
  return (
    norm === 'SCHEDULE_H1' ||
    norm === 'H1' ||
    norm === 'SCHEDULE_X' ||
    norm === 'X' ||
    norm === 'NARCOTIC' ||
    norm === 'PSYCHOTROPIC' ||
    norm === 'CONTROLLED'
  );
}

export function getOnboardingState(storeId: string): OnboardingStateDTO {
  const store = sqlite
    .prepare(
      `SELECT s.*, b.gstin
       FROM stores s
       JOIN businesses b ON b.id = s.business_id
       WHERE s.id = ?`
    )
    .get(storeId) as Record<string, unknown> | undefined;

  const row = sqlite
    .prepare('SELECT * FROM store_onboarding_state WHERE store_id = ?')
    .get(storeId) as
    | {
        store_id: string;
        current_step: number;
        steps_completed_json: string;
        compliance_signed_off: number;
        signed_off_by: string | null;
        signed_off_at: string | null;
        production_sales_enabled: number;
      }
    | undefined;

  const settingsRows = sqlite
    .prepare("SELECT key, value FROM store_settings WHERE store_id = ? AND key = 'productionSalesEnabled'")
    .all(storeId) as Array<{ key: string; value: string }>;
  const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));

  const pincodeCount = (
    sqlite.prepare('SELECT COUNT(*) as c FROM serviceable_pincodes WHERE store_id = ? AND is_active = 1').get(storeId) as { c: number }
  ).c;

  const realMedicineCount = (
    sqlite
      .prepare('SELECT COUNT(*) as c FROM medicines WHERE business_id = ? AND is_active = 1')
      .get(String(store?.business_id || '')) as { c: number }
  ).c;

  const pharmacistCount = (
    sqlite
      .prepare("SELECT COUNT(*) as c FROM user_roles WHERE store_id = ? AND role = 'PHARMACIST'")
      .get(storeId) as { c: number }
  ).c;

  const riderCount = (
    sqlite
      .prepare("SELECT COUNT(*) as c FROM delivery_partners WHERE store_id = ? AND COALESCE(account_status, 'ACTIVE') = 'ACTIVE'")
      .get(storeId) as { c: number }
  ).c;

  const policyCount = (
    sqlite.prepare('SELECT COUNT(*) as c FROM legal_policies WHERE store_id = ?').get(storeId) as { c: number }
  ).c;

  let manualSteps: Record<string, boolean> = {};
  try {
    manualSteps = row?.steps_completed_json ? JSON.parse(row.steps_completed_json) : {};
  } catch {
    manualSteps = {};
  }

  const hasValidIdentity = Boolean(
    store &&
      !Boolean(store.logo_placeholder) &&
      store.logo_url &&
      store.storefront_photo_url &&
      store.phone &&
      store.address_line1
  );

  const drugLic = String(store?.drug_license_number || '');
  const pharmReg = String(store?.pharmacist_reg_number || '');
  const hasRealLicense =
    drugLic.length >= 6 &&
    !drugLic.toUpperCase().includes('DEMO') &&
    !drugLic.toUpperCase().includes('REPLACE') &&
    pharmReg.length >= 5 &&
    !pharmReg.toUpperCase().includes('DEMO');

  const gstin = String(store?.gstin || '');
  const hasRealGstAndZones =
    gstin.length >= 10 &&
    !gstin.toUpperCase().includes('DEMO') &&
    !gstin.toUpperCase().includes('PLACEHOLDER') &&
    pincodeCount >= 1;

  const steps: OnboardingStepDTO[] = [
    {
      key: 'identity_media',
      label: '1. Store Identity, Real Logo & Storefront Photo',
      completed: hasValidIdentity || Boolean(manualSteps.identity_media && store?.logo_url),
      detail: hasValidIdentity
        ? 'Store logo and storefront photo uploaded'
        : 'Upload real pharmacy logo & storefront photograph in Store Settings or below',
    },
    {
      key: 'drug_license_pharmacist',
      label: '2. Retail Drug License & Registered Pharmacist Credentials',
      completed: hasRealLicense,
      detail: hasRealLicense
        ? `License ${drugLic} · Pharmacist Reg ${pharmReg}`
        : 'Replace demonstration Drug License and Pharmacist Reg No. with verified state council credentials',
    },
    {
      key: 'gst_delivery_zones',
      label: '3. GSTIN, Delivery Radius & Serviceable PIN Zones',
      completed: hasRealGstAndZones,
      detail: hasRealGstAndZones
        ? `GSTIN verified · ${pincodeCount} active PIN zone(s)`
        : 'Enter valid 15-char GSTIN and verify at least 1 active serviceable PIN code',
    },
    {
      key: 'catalog_inventory',
      label: '4. Verified Medicine Catalogue & Batch Stock',
      completed: realMedicineCount >= 5 && Boolean(manualSteps.catalog_inventory),
      detail: `${realMedicineCount} active catalogue items · confirm opening batch stock & expiry dates`,
    },
    {
      key: 'staff_delivery',
      label: '5. Registered Pharmacist & Delivery Fleet Accounts',
      completed: pharmacistCount >= 1 && riderCount >= 1 && Boolean(manualSteps.staff_delivery),
      detail: `${pharmacistCount} pharmacist(s) · ${riderCount} active delivery partner(s)`,
    },
    {
      key: 'payments_policies',
      label: '6. Payment Mode & Legal Policies Review',
      completed: policyCount >= 4 && Boolean(manualSteps.payments_policies),
      detail: `${policyCount} statutory legal policies active · Razorpay / COD configured`,
    },
    {
      key: 'compliance_launch',
      label: '7. Production Compliance Sign-Off',
      completed: Boolean(row?.compliance_signed_off),
      detail: row?.compliance_signed_off
        ? `Signed off on ${row.signed_off_at}`
        : 'Confirm regulatory compliance checklist before enabling live production sales',
    },
  ];

  const blockers: string[] = [];
  if (!hasRealLicense) blockers.push('Verified Retail Drug License & Registered Pharmacist Registration required');
  if (!hasRealGstAndZones) blockers.push('Verified non-demo GSTIN & serviceable PIN code required');
  if (!store?.logo_url || Boolean(store?.logo_placeholder)) blockers.push('Real store logo upload required');
  if (!row?.compliance_signed_off) blockers.push('Store Owner / Pharmacist compliance sign-off required');

  return {
    storeId,
    currentStep: row?.current_step || 1,
    complianceSignedOff: Boolean(row?.compliance_signed_off),
    signedOffBy: row?.signed_off_by || null,
    signedOffAt: row?.signed_off_at || null,
    productionSalesEnabled: Boolean(row?.production_sales_enabled) && settingsMap.productionSalesEnabled === 'true',
    demoMode: false,
    liveModeEligible: blockers.length === 0,
    steps,
    blockers,
  };
}

export function updateOnboardingProgress(params: {
  storeId: string;
  currentStep?: number;
  completedStepKey?: string;
  completed?: boolean;
}): OnboardingStateDTO {
  const now = new Date().toISOString();
  const row = sqlite
    .prepare('SELECT current_step, steps_completed_json FROM store_onboarding_state WHERE store_id = ?')
    .get(params.storeId) as { current_step: number; steps_completed_json: string } | undefined;

  let map: Record<string, boolean> = {};
  try {
    map = row?.steps_completed_json ? JSON.parse(row.steps_completed_json) : {};
  } catch {
    map = {};
  }
  if (params.completedStepKey) {
    map[params.completedStepKey] = params.completed !== false;
  }

  sqlite
    .prepare(
      `INSERT INTO store_onboarding_state (store_id, current_step, steps_completed_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(store_id) DO UPDATE SET
         current_step = COALESCE(?, current_step),
         steps_completed_json = ?,
         updated_at = ?`
    )
    .run(
      params.storeId,
      params.currentStep ?? row?.current_step ?? 1,
      JSON.stringify(map),
      now,
      params.currentStep ?? null,
      JSON.stringify(map),
      now
    );

  return getOnboardingState(params.storeId);
}

export function signOffOnboardingLaunch(params: {
  storeId: string;
  actorUserId: string;
  enableProductionSales: boolean;
}): { ok: boolean; state: OnboardingStateDTO; error?: string } {
  const current = getOnboardingState(params.storeId);
  const now = new Date().toISOString();

  // Check hard blockers excluding the signoff itself & demoMode toggle
  const hardBlockers = current.blockers.filter(
    (b) =>
      !b.includes('compliance sign-off') &&
      !b.includes('Demonstration Mode')
  );

  if (params.enableProductionSales && hardBlockers.length > 0) {
    return {
      ok: false,
      state: current,
      error: `Cannot enable production medicine sales yet: ${hardBlockers.join('; ')}`,
    };
  }

  databaseService.withTransaction(() => {
    sqlite
      .prepare(
        `UPDATE store_onboarding_state
         SET compliance_signed_off = 1,
             signed_off_by = ?,
             signed_off_at = ?,
             production_sales_enabled = ?,
             current_step = 7,
             updated_at = ?
         WHERE store_id = ?`
      )
      .run(
        params.actorUserId,
        now,
        params.enableProductionSales ? 1 : 0,
        now,
        params.storeId
      );

    sqlite
      .prepare(
        `INSERT INTO store_settings (id, store_id, key, value, updated_at)
         VALUES (?, ?, 'productionSalesEnabled', ?, ?)
         ON CONFLICT(store_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(crypto.randomUUID(), params.storeId, params.enableProductionSales ? 'true' : 'false', now);


  });

  return { ok: true, state: getOnboardingState(params.storeId) };
}
