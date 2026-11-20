import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { sqlite, databaseService } from '../db/sqlite-db.ts';
import {
  authService,
  clearSessionCookie,
  getUserDTOById,
  GUEST_CART_COOKIE_NAME,
  requireAuth,
  setSessionCookie,
  type AuthenticatedRequest,
} from '../services/auth-service.ts';
import { storageService } from '../services/storage-service.ts';
import { mapsAdapter } from '../services/maps-adapter.ts';
import { realtimeService } from '../services/realtime-service.ts';
import {
  createSignedFileUrl,
  malwareScannerService,
  sanitizeTextInput,
} from '../services/security-service.ts';
import {
  getUserNotificationPreferences,
  notificationService,
  updateUserNotificationPreferences,
} from '../services/notification-service.ts';
import { paymentGatewayService } from '../services/payment-gateway-service.ts';
import { orderLifecycleService } from '../services/order-lifecycle-service.ts';
import { isScheduleBlockedOnline } from '../services/onboarding-compliance-service.ts';
import {
  FulfillmentType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PrescriptionStatus,
  Role,
  type CartDTO,
  type CartItemDTO,
  type MedicineDTO,
  type MedicineImageDTO,
  type PromotionBannerDTO,
  type PublicStoreInfo,
  type ServiceablePincodeDTO,
} from '../../shared/types.ts';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  const curr = new Array<number>(t.length + 1);
  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= t.length; j++) prev[j] = curr[j];
  }
  return prev[t.length];
}

export function getPublicStoreInfo(): PublicStoreInfo {
  const store = sqlite
    .prepare(
      `SELECT s.*, b.gstin, b.currency, b.timezone
       FROM stores s
       JOIN businesses b ON b.id = s.business_id
       WHERE s.is_active = 1
       LIMIT 1`
    )
    .get() as Record<string, unknown>;

  const settingsRows = sqlite
    .prepare('SELECT key, value FROM store_settings WHERE store_id = ?')
    .all(store.id as string) as Array<{ key: string; value: string }>;

  const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));

  return {
    id: store.id as string,
    businessId: store.business_id as string,
    code: store.code as string,
    name: store.name as string,
    addressLine1: store.address_line1 as string,
    landmark: (store.landmark as string) || null,
    city: store.city as string,
    state: store.state as string,
    postalCode: store.postal_code as string,
    country: store.country as string,
    phone: store.phone as string,
    email: (store.email as string) || null,
    operatingHours: store.operating_hours as string,
    latitude: Number(store.latitude),
    longitude: Number(store.longitude),
    googleMapsUrl: (store.google_maps_url as string) || 'https://maps.app.goo.gl/t2GPkm2kVdTe4Cw46',
    drugLicenseNumber: (store.drug_license_number as string) || null,
    pharmacistName: (store.pharmacist_name as string) || null,
    pharmacistRegNumber: (store.pharmacist_reg_number as string) || null,
    gstin: (store.gstin as string) || null,
    currency: (store.currency as string) || 'INR',
    timezone: (store.timezone as string) || 'Asia/Kolkata',
    logoPlaceholder: Boolean(store.logo_placeholder),
    logoUrl: (store.logo_url as string) || null,
    storefrontPhotoUrl: (store.storefront_photo_url as string) || null,
    demoMode: settingsMap.demoMode !== 'false',
    productionSalesEnabled: settingsMap.productionSalesEnabled === 'true',
    deliveryFeePaise: Number(settingsMap.deliveryFeePaise ?? 2500),
    freeDeliveryThresholdPaise: Number(settingsMap.freeDeliveryThresholdPaise ?? 49900),
    minimumOrderPaise: Number(settingsMap.minimumOrderPaise ?? 0),
    deliveryRadiusKm: Number(settingsMap.deliveryRadiusKm ?? 6),
  };
}

export function buildMedicineDTO(r: Record<string, unknown>, images?: MedicineImageDTO[]): MedicineDTO {
  const isActive = Boolean(r.is_active);
  const isPharmacistApproved = r.is_pharmacist_approved === undefined ? true : Boolean(r.is_pharmacist_approved);
  const isRecalled = Boolean(r.is_recalled);
  const scheduleRestricted = isScheduleBlockedOnline(String(r.schedule_type || 'OTC'));
  const onlineSaleRestricted = Boolean(r.online_sale_restricted) || scheduleRestricted;
  const availableStock = Number(r.available_stock ?? 0);

  let unavailableReason: string | null = null;
  if (isRecalled) {
    unavailableReason = 'Product recalled by pharmacy quality control';
  } else if (onlineSaleRestricted) {
    unavailableReason = scheduleRestricted
      ? `${String(r.schedule_type)} controlled medicine — store visit & physical Rx required`
      : 'Restricted for online sale — visit store with Rx';
  } else if (!isPharmacistApproved || !isActive) {
    unavailableReason = 'Pending pharmacist catalog approval';
  } else if (availableStock <= 0) {
    unavailableReason = 'Currently out of stock or unexpired batch unavailable';
  }

  return {
    id: r.id as string,
    sku: r.sku as string,
    barcode: (r.barcode as string) || null,
    name: r.name as string,
    slug: r.slug as string,
    genericName: r.generic_name as string,
    brand: (r.brand as string) || null,
    strength: (r.strength as string) || null,
    composition: r.composition as string,
    dosageForm: r.dosage_form as string,
    packSize: r.pack_size as string,
    scheduleType: r.schedule_type as string,
    requiresPrescription: Boolean(r.requires_prescription),
    mrpPaise: Number(r.mrp_paise),
    salePricePaise: Number(r.sale_price_paise),
    gstPercent: Number(r.gst_percent),
    hsnCode: (r.hsn_code as string) || null,
    storageInstructions: (r.storage_instructions as string) || null,
    usageSummary: (r.usage_summary as string) || null,
    sideEffectsSummary: (r.side_effects_summary as string) || null,
    safetyAdvice: (r.safety_advice as string) || null,
    isActive,
    isDemoData: Boolean(r.is_demo_data),
    isFeatured: Boolean(r.is_featured),
    isEssential: Boolean(r.is_essential),
    isPharmacistApproved,
    isRecalled,
    onlineSaleRestricted,
    canPurchase: unavailableReason === null,
    unavailableReason,
    categoryId: r.category_id as string,
    categoryName: r.category_name as string,
    categorySlug: r.category_slug as string,
    subcategoryName: (r.subcategory_name as string) || null,
    subcategorySlug: (r.subcategory_slug as string) || null,
    manufacturerName: r.manufacturer_name as string,
    imageUrl: (r.image_url as string) || '',
    images,
    availableStock,
    nearestExpiry: (r.nearest_expiry as string) || null,
  };
}

const BASE_MEDICINE_SELECT = `
  SELECT m.*, c.name as category_name, c.slug as category_slug,
         sc.name as subcategory_name, sc.slug as subcategory_slug,
         mf.name as manufacturer_name,
         COALESCE((SELECT image_url FROM medicine_images WHERE medicine_id = m.id AND is_primary = 1 LIMIT 1), '') as image_url,
         COALESCE((SELECT SUM(quantity_available) FROM medicine_batches WHERE medicine_id = m.id AND store_id = ? AND expiry_date > date('now') AND COALESCE(is_quarantined, 0) = 0), 0) as available_stock,
         (SELECT MIN(expiry_date) FROM medicine_batches WHERE medicine_id = m.id AND store_id = ? AND quantity_available > 0 AND expiry_date > date('now') AND COALESCE(is_quarantined, 0) = 0) as nearest_expiry
  FROM medicines m
  JOIN categories c ON c.id = m.category_id
  LEFT JOIN subcategories sc ON sc.id = m.subcategory_id
  JOIN manufacturers mf ON mf.id = m.manufacturer_id
`;

function getOrCreateCartId(req: AuthenticatedRequest, res: { cookie: Function }, storeId: string): string {
  if (req.auth) {
    const existing = sqlite
      .prepare('SELECT id FROM carts WHERE user_id = ? AND store_id = ? LIMIT 1')
      .get(req.auth.userId, storeId) as { id: string } | undefined;
    if (existing) return existing.id;

    const guestKey = req.cookies?.[GUEST_CART_COOKIE_NAME];
    if (guestKey) {
      const guestCart = sqlite
        .prepare('SELECT id FROM carts WHERE guest_key = ? AND store_id = ? LIMIT 1')
        .get(guestKey, storeId) as { id: string } | undefined;
      if (guestCart) {
        sqlite
          .prepare('UPDATE carts SET user_id = ?, guest_key = NULL, updated_at = ? WHERE id = ?')
          .run(req.auth.userId, new Date().toISOString(), guestCart.id);
        return guestCart.id;
      }
    }

    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare('INSERT INTO carts (id, store_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId, storeId, req.auth.userId, now, now);
    return newId;
  }

  let guestKey = req.cookies?.[GUEST_CART_COOKIE_NAME];
  if (guestKey) {
    const existing = sqlite
      .prepare('SELECT id FROM carts WHERE guest_key = ? AND store_id = ? LIMIT 1')
      .get(guestKey, storeId) as { id: string } | undefined;
    if (existing) return existing.id;
  }

  guestKey = crypto.randomUUID();
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(GUEST_CART_COOKIE_NAME, guestKey, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 14 * 24 * 60 * 60 * 1000,
    path: '/',
  });

  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare('INSERT INTO carts (id, store_id, guest_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(newId, storeId, guestKey, now, now);
  return newId;
}

function buildCartDTO(cartId: string, storeId: string, req: AuthenticatedRequest): CartDTO {
    const rows = sqlite
    .prepare(
      `SELECT ci.id, ci.medicine_id, ci.quantity, m.slug, m.name, m.generic_name, m.strength, m.pack_size, m.schedule_type,
              m.requires_prescription, m.mrp_paise, m.sale_price_paise, m.gst_percent, m.is_demo_data,
              m.is_active, m.is_pharmacist_approved, m.is_recalled, m.online_sale_restricted,
              mf.name as manufacturer_name,
              COALESCE((SELECT image_url FROM medicine_images WHERE medicine_id = m.id AND is_primary = 1 LIMIT 1), '') as image_url,
              COALESCE((SELECT SUM(quantity_available) FROM medicine_batches WHERE medicine_id = m.id AND store_id = ? AND expiry_date > date('now') AND COALESCE(is_quarantined, 0) = 0), 0) as available_stock
       FROM cart_items ci
       JOIN medicines m ON m.id = ci.medicine_id
       JOIN manufacturers mf ON mf.id = m.manufacturer_id
       WHERE ci.cart_id = ?
       ORDER BY ci.created_at ASC`
    )
    .all(storeId, cartId) as Array<Record<string, unknown>>;

  const items: CartItemDTO[] = rows.map((r) => {
    const stock = Number(r.available_stock);
    const scheduleRestricted = isScheduleBlockedOnline(String(r.schedule_type || 'OTC'));
    const canPurchase =
      Boolean(r.is_active) &&
      Boolean(r.is_pharmacist_approved) &&
      !Boolean(r.is_recalled) &&
      !Boolean(r.online_sale_restricted) &&
      !scheduleRestricted &&
      stock > 0;
    return {
      id: r.id as string,
      medicineId: r.medicine_id as string,
      slug: r.slug as string,
      name: r.name as string,
      genericName: r.generic_name as string,
      manufacturerName: r.manufacturer_name as string,
      strength: (r.strength as string) || null,
      packSize: r.pack_size as string,
      requiresPrescription: Boolean(r.requires_prescription),
      mrpPaise: Number(r.mrp_paise),
      salePricePaise: Number(r.sale_price_paise),
      gstPercent: Number(r.gst_percent),
      quantity: Number(r.quantity),
      availableStock: stock,
      canPurchase,
      imageUrl: r.image_url as string,
      isDemoData: Boolean(r.is_demo_data),
    };
  });

  // Saved for later items
  let savedRows: Array<Record<string, unknown>> = [];
  const guestKey = req.cookies?.[GUEST_CART_COOKIE_NAME];
  if (req.auth) {
    savedRows = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         JOIN saved_items si ON si.medicine_id = m.id
         WHERE si.user_id = ? AND si.list_type = 'CART_SAVED' AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'
         ORDER BY si.created_at DESC`
      )
      .all(storeId, storeId, req.auth.userId) as Array<Record<string, unknown>>;
  } else if (guestKey) {
    savedRows = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         JOIN saved_items si ON si.medicine_id = m.id
         WHERE si.guest_key = ? AND si.list_type = 'CART_SAVED' AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'
         ORDER BY si.created_at DESC`
      )
      .all(storeId, storeId, guestKey) as Array<Record<string, unknown>>;
  }

  const subtotalPaise = items.reduce((sum, i) => sum + i.salePricePaise * i.quantity, 0);
  const mrpTotalPaise = items.reduce((sum, i) => sum + i.mrpPaise * i.quantity, 0);

  return {
    id: cartId,
    items,
    savedForLater: savedRows.map((r) => buildMedicineDTO(r)),
    subtotalPaise,
    mrpTotalPaise,
    savingsPaise: Math.max(0, mrpTotalPaise - subtotalPaise),
    requiresPrescription: items.some((i) => i.requiresPrescription),
  };
}

function getCategoriesWithSubcategories(businessId: string) {
  const categories = sqlite
    .prepare(
      `SELECT c.id, c.name, c.slug, c.description, c.icon_name, c.banner_url, c.seo_description, c.is_featured, c.display_order,
              COUNT(m.id) as medicine_count
       FROM categories c
       LEFT JOIN medicines m ON m.category_id = c.id AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'
       WHERE c.business_id = ? AND c.is_active = 1
       GROUP BY c.id
       ORDER BY c.display_order ASC`
    )
    .all(businessId) as Array<Record<string, unknown>>;

  const subRows = sqlite
    .prepare('SELECT id, category_id, name, slug FROM subcategories WHERE is_active = 1 ORDER BY name ASC')
    .all() as Array<{ id: string; category_id: string; name: string; slug: string }>;

  return categories.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    slug: c.slug as string,
    description: (c.description as string) || null,
    iconName: (c.icon_name as string) || null,
    bannerUrl: (c.banner_url as string) || null,
    seoDescription: (c.seo_description as string) || null,
    isFeatured: Boolean(c.is_featured),
    displayOrder: Number(c.display_order),
    medicineCount: Number(c.medicine_count),
    subcategories: subRows.filter((s) => s.category_id === c.id),
  }));
}

export function createPublicCustomerRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    let dbHealthy = false;
    try {
      const check = sqlite.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
      dbHealthy = check?.ok === 1;
    } catch {
      dbHealthy = false;
    }
    const store = getPublicStoreInfo();
    const livePay = paymentGatewayService.isLiveModeAllowed(store.id);
    res.setHeader('Cache-Control', 'no-store');
    res.status(dbHealthy ? 200 : 503).json({
      ok: dbHealthy,
      db: dbHealthy ? 'connected' : 'disconnected',
      uptimeSec: Math.round(process.uptime()),
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      integrations: {
        razorpayMode: livePay.allowed ? 'live' : 'test',
        razorpayKeyConfigured: Boolean(process.env.RAZORPAY_KEY_ID),
        mapsConfigured: mapsAdapter.isConfigured(),
        emailConfigured: Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST),
        smsConfigured: Boolean(process.env.SMS_API_KEY),
        whatsappConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      },
      compliance: {
        demoMode: store.demoMode,
        productionSalesEnabled: Boolean(store.productionSalesEnabled),
      },
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/store/public', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json(getPublicStoreInfo());
  });

  router.get('/store/policies', (_req, res) => {
    const store = getPublicStoreInfo();
    const rows = sqlite
      .prepare('SELECT id, slug, title, content, updated_at as updatedAt FROM legal_policies WHERE store_id = ? ORDER BY title ASC')
      .all(store.id);
    res.json({ policies: rows });
  });

  // Delivery Location & PIN Code Serviceability
  router.get('/store/serviceability', (req, res) => {
    const store = getPublicStoreInfo();
    const pincode = typeof req.query.pincode === 'string' ? req.query.pincode.trim() : '';
    const allRows = sqlite
      .prepare('SELECT id, pincode, area_name, delivery_fee_paise, estimated_mins, is_active FROM serviceable_pincodes WHERE store_id = ? AND is_active = 1 ORDER BY pincode ASC')
      .all(store.id) as Array<Record<string, unknown>>;

    const allPincodes: ServiceablePincodeDTO[] = allRows.map((p) => ({
      id: p.id as string,
      pincode: p.pincode as string,
      areaName: p.area_name as string,
      deliveryFeePaise: Number(p.delivery_fee_paise),
      estimatedMins: Number(p.estimated_mins),
      isActive: Boolean(p.is_active),
    }));

    if (!pincode) {
      res.json({ serviceable: true, defaultPincode: store.postalCode, allPincodes });
      return;
    }

    const match = allPincodes.find((p) => p.pincode === pincode);
    res.json({
      serviceable: Boolean(match),
      pincode,
      areaName: match ? match.areaName : null,
      deliveryFeePaise: match ? match.deliveryFeePaise : store.deliveryFeePaise,
      estimatedMins: match ? match.estimatedMins : null,
      allPincodes,
    });
  });

  // Homepage Aggregated Payload (Admin-Configurable Banners, Featured, Essentials, Categories)
  router.get('/homepage', (_req, res) => {
    const store = getPublicStoreInfo();
    const promoRows = sqlite
      .prepare('SELECT * FROM store_promotions WHERE store_id = ? AND is_active = 1 ORDER BY display_order ASC')
      .all(store.id) as Array<Record<string, unknown>>;

    const promotions: PromotionBannerDTO[] = promoRows.map((p) => ({
      id: p.id as string,
      title: p.title as string,
      subtitle: p.subtitle as string,
      ctaLabel: p.cta_label as string,
      ctaLink: p.cta_link as string,
      badgeText: (p.badge_text as string) || null,
      displayOrder: Number(p.display_order),
      isActive: Boolean(p.is_active),
      isDemoData: Boolean(p.is_demo_data),
    }));

    const featuredRows = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         WHERE m.business_id = ? AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED' AND m.is_featured = 1
         ORDER BY m.name ASC
         LIMIT 8`
      )
      .all(store.id, store.id, store.businessId) as Array<Record<string, unknown>>;

    const essentialRows = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         WHERE m.business_id = ? AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED' AND m.is_essential = 1
         ORDER BY m.name ASC
         LIMIT 8`
      )
      .all(store.id, store.id, store.businessId) as Array<Record<string, unknown>>;

    const pinRows = sqlite
      .prepare('SELECT id, pincode, area_name, delivery_fee_paise, estimated_mins, is_active FROM serviceable_pincodes WHERE store_id = ? AND is_active = 1 ORDER BY pincode ASC')
      .all(store.id) as Array<Record<string, unknown>>;

    res.json({
      store,
      promotions,
      categories: getCategoriesWithSubcategories(store.businessId),
      featuredMedicines: featuredRows.map((r) => buildMedicineDTO(r)),
      essentialMedicines: essentialRows.map((r) => buildMedicineDTO(r)),
      popularSearches: [
        'Paracetamol 500mg',
        'Metformin SR',
        'Telmisartan 40mg',
        'Pantoprazole',
        'Cetirizine 10mg',
        'Multivitamin',
        'BP Monitor',
        'Antacid Suspension',
      ],
      serviceablePincodes: pinRows.map((p) => ({
        id: p.id as string,
        pincode: p.pincode as string,
        areaName: p.area_name as string,
        deliveryFeePaise: Number(p.delivery_fee_paise),
        estimatedMins: Number(p.estimated_mins),
        isActive: Boolean(p.is_active),
      })),
    });
  });

  // Authentication Endpoints
  const registerSchema = z.object({
    fullName: z.string().trim().min(2).max(100),
    email: z.string().trim().email().toLowerCase(),
    phone: z.string().trim().min(10).max(16),
    password: z.string().min(8).max(128),
    rememberMe: z.boolean().optional().default(true),
  });

  router.post('/auth/register', async (req: AuthenticatedRequest, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid registration details', issues: parsed.error.flatten() });
      return;
    }

    const { fullName, email, phone, password, rememberMe } = parsed.data;
    const existing = sqlite
      .prepare('SELECT id FROM users WHERE lower(email) = lower(?) OR phone = ?')
      .get(email, phone) as { id: string } | undefined;

    if (existing) {
      res.status(409).json({ error: 'An account with this email or phone number already exists' });
      return;
    }

    const store = getPublicStoreInfo();
    const userId = crypto.randomUUID();
    const passwordHash = await authService.hashPassword(password);
    const now = new Date().toISOString();

    databaseService.withTransaction(() => {
      sqlite
        .prepare(
          `INSERT INTO users (id, business_id, email, phone, full_name, password_hash, is_email_verified, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(userId, store.businessId, email, phone, fullName, passwordHash, 0, 1, now, now);

      sqlite
        .prepare('INSERT INTO user_roles (id, user_id, store_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), userId, store.id, Role.CUSTOMER, now);

      sqlite
        .prepare(
          `INSERT INTO customer_profiles (id, user_id, preferred_language, loyalty_points, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(crypto.randomUUID(), userId, 'en', 0, now, now);

      sqlite
        .prepare(
          `INSERT INTO audit_logs (id, business_id, store_id, actor_user_id, action, entity_type, entity_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(crypto.randomUUID(), store.businessId, store.id, userId, 'CUSTOMER_REGISTERED', 'User', userId, now);
    });

    const verificationToken = await authService.createEmailVerificationToken(userId);
    const { token, expiresAt } = await authService.createSession(userId, rememberMe, req.headers['user-agent']);
    setSessionCookie(res, token, expiresAt);

    void notificationService.notify({
      userId,
      template: 'ACCOUNT_REGISTERED',
      variables: { fullName },
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      user: getUserDTOById(userId),
      verificationPreviewToken: verificationToken,
    });
  });

  const loginSchema = z.object({
    email: z.string().trim().email().toLowerCase(),
    password: z.string().min(1),
    rememberMe: z.boolean().optional().default(false),
  });

  router.post('/auth/login', async (req: AuthenticatedRequest, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email and password are required' });
      return;
    }

    const { email, password, rememberMe } = parsed.data;
    const userRow = sqlite
      .prepare('SELECT id, password_hash, is_active FROM users WHERE lower(email) = lower(?)')
      .get(email) as { id: string; password_hash: string; is_active: number } | undefined;

    if (!userRow || !userRow.is_active) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const valid = await authService.verifyPassword(password, userRow.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const { token, expiresAt } = await authService.createSession(userRow.id, rememberMe, req.headers['user-agent']);
    setSessionCookie(res, token, expiresAt);

    res.json({ user: getUserDTOById(userRow.id) });
  });

  router.post('/auth/logout', async (req: AuthenticatedRequest, res) => {
    const token = req.cookies?.slm_session;
    if (token) {
      await authService.revokeSession(token);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/auth/me', (req: AuthenticatedRequest, res) => {
    if (!req.auth) {
      res.json({ user: null });
      return;
    }
    res.json({ user: getUserDTOById(req.auth.userId) });
  });

  router.post('/auth/verify-email', async (req, res) => {
    const token = z.object({ token: z.string().min(6) }).safeParse(req.body);
    if (!token.success) {
      res.status(400).json({ error: 'Verification token required' });
      return;
    }
    const verified = await authService.verifyEmailToken(token.data.token);
    if (!verified) {
      res.status(400).json({ error: 'Verification token is invalid or expired' });
      return;
    }
    res.json({ ok: true, user: getUserDTOById(verified.userId) });
  });

  router.post('/auth/resend-verification', requireAuth, async (req: AuthenticatedRequest, res) => {
    const token = await authService.createEmailVerificationToken(req.auth!.userId);
    res.json({ ok: true, verificationPreviewToken: token });
  });

  router.post('/auth/forgot-password', async (req, res) => {
    const parsed = z.object({ email: z.string().trim().email() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }
    const resetToken = await authService.createPasswordResetToken(parsed.data.email);
    res.json({
      ok: true,
      message: 'If an account matches this email, password reset instructions have been generated.',
      resetPreviewToken: resetToken,
    });
  });

  router.post('/auth/reset-password', async (req, res) => {
    const parsed = z
      .object({
        token: z.string().min(6),
        newPassword: z.string().min(8).max(128),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid reset token and password (min 8 chars) are required' });
      return;
    }
    const ok = await authService.resetPasswordWithToken(parsed.data.token, parsed.data.newPassword);
    if (!ok) {
      res.status(400).json({ error: 'Reset token is invalid or expired' });
      return;
    }
    res.json({ ok: true });
  });

  router.patch('/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        fullName: z.string().trim().min(2).max(100),
        phone: z.string().trim().min(10).max(16),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid profile details' });
      return;
    }
    sqlite
      .prepare('UPDATE users SET full_name = ?, phone = ?, updated_at = ? WHERE id = ?')
      .run(parsed.data.fullName, parsed.data.phone, new Date().toISOString(), req.auth!.userId);
    res.json({ user: getUserDTOById(req.auth!.userId) });
  });

  // Catalog & Intelligent Search Endpoints
  router.get('/catalog/categories', (_req, res) => {
    const store = getPublicStoreInfo();
    res.json({ categories: getCategoriesWithSubcategories(store.businessId) });
  });

  router.get('/catalog/suggest', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) {
      res.json({ suggestions: [] });
      return;
    }
    const store = getPublicStoreInfo();
    const rows = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         WHERE m.business_id = ? AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'`
      )
      .all(store.id, store.id, store.businessId) as Array<Record<string, unknown>>;

    const qLower = q.toLowerCase();
    const scored = rows
      .map((r) => {
        const dto = buildMedicineDTO(r);
        const fields = [
          dto.name,
          dto.genericName,
          dto.composition,
          dto.manufacturerName,
          dto.brand || '',
          dto.strength || '',
          dto.sku,
          dto.barcode || '',
        ];
        const exact = fields.some((f) => f.toLowerCase().includes(qLower));
        let score = exact ? 0 : 99;
        if (!exact) {
          const words = fields.join(' ').toLowerCase().split(/[\s/+,-]+/).filter((w) => w.length >= 3);
          for (const w of words) {
            const dist = levenshtein(qLower, w.slice(0, Math.max(qLower.length, w.length)));
            if (dist <= 2 && dist < score) score = dist;
          }
        }
        return { dto, score };
      })
      .filter((x) => x.score <= 2)
      .sort((a, b) => a.score - b.score || a.dto.name.localeCompare(b.dto.name))
      .slice(0, 8);

    res.json({
      suggestions: scored.map((s) => ({
        id: s.dto.id,
        slug: s.dto.slug,
        name: s.dto.name,
        genericName: s.dto.genericName,
        manufacturerName: s.dto.manufacturerName,
        strength: s.dto.strength,
        packSize: s.dto.packSize,
        salePricePaise: s.dto.salePricePaise,
        requiresPrescription: s.dto.requiresPrescription,
        canPurchase: s.dto.canPurchase,
        imageUrl: s.dto.imageUrl,
        fuzzyMatch: s.score > 0,
      })),
    });
  });

  router.get('/catalog/medicines', (req, res) => {
    const store = getPublicStoreInfo();
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const subcategory = typeof req.query.subcategory === 'string' ? req.query.subcategory.trim() : '';
    const manufacturer = typeof req.query.manufacturer === 'string' ? req.query.manufacturer.trim() : '';
    const form = typeof req.query.form === 'string' ? req.query.form.trim() : '';
    const inStock = req.query.inStock === 'true';
    const rxOnly = req.query.rx === 'true' ? true : req.query.rx === 'false' ? false : null;
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : null;
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'relevance';
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(48, Math.max(1, Number(req.query.limit || 12)));

    // Only pharmacist-approved & active products appear in the live customer catalog
    const allRows = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         WHERE m.business_id = ? AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'`
      )
      .all(store.id, store.id, store.businessId) as Array<Record<string, unknown>>;

    const allDTOs = allRows.map((r) => buildMedicineDTO(r));

    const facets = {
      manufacturers: Array.from(new Set(allDTOs.map((m) => m.manufacturerName))).sort(),
      forms: Array.from(new Set(allDTOs.map((m) => m.dosageForm))).sort(),
    };

    let filtered = allDTOs;
    if (category) filtered = filtered.filter((m) => m.categorySlug === category);
    if (subcategory) filtered = filtered.filter((m) => m.subcategorySlug === subcategory);
    if (manufacturer) filtered = filtered.filter((m) => m.manufacturerName === manufacturer);
    if (form) filtered = filtered.filter((m) => m.dosageForm === form);
    if (inStock) filtered = filtered.filter((m) => m.availableStock > 0 && m.canPurchase);
    if (rxOnly === true) filtered = filtered.filter((m) => m.requiresPrescription);
    if (rxOnly === false) filtered = filtered.filter((m) => !m.requiresPrescription);
    if (minPrice !== null && !Number.isNaN(minPrice)) filtered = filtered.filter((m) => m.salePricePaise >= minPrice);
    if (maxPrice !== null && !Number.isNaN(maxPrice)) filtered = filtered.filter((m) => m.salePricePaise <= maxPrice);

    let typoSuggestedQuery: string | null = null;
    if (q) {
      const qLower = q.toLowerCase();
      const exactMatches = filtered.filter((m) =>
        [
          m.name,
          m.genericName,
          m.composition,
          m.manufacturerName,
          m.brand || '',
          m.strength || '',
          m.sku,
          m.barcode || '',
        ].some((f) => f.toLowerCase().includes(qLower))
      );

      if (exactMatches.length > 0) {
        filtered = exactMatches;
      } else {
        // Typo-tolerant fallback across indexed tokens
        const fuzzyScored = filtered
          .map((m) => {
            const tokens = [m.name, m.genericName, m.composition, m.manufacturerName, m.brand || '', m.sku]
              .join(' ')
              .toLowerCase()
              .split(/[\s/+,-]+/)
              .filter((w) => w.length >= 3);
            let bestDist = 99;
            let bestToken = '';
            for (const w of tokens) {
              const dist = levenshtein(qLower, w.slice(0, Math.max(qLower.length, w.length)));
              if (dist < bestDist) {
                bestDist = dist;
                bestToken = w;
              }
            }
            return { m, bestDist, bestToken };
          })
          .filter((x) => x.bestDist <= 2)
          .sort((a, b) => a.bestDist - b.bestDist);

        if (fuzzyScored.length > 0) {
          typoSuggestedQuery = fuzzyScored[0].bestToken;
          filtered = fuzzyScored.map((x) => x.m);
        } else {
          filtered = [];
        }
      }
    }

    if (sort === 'price_asc') {
      filtered.sort((a, b) => a.salePricePaise - b.salePricePaise);
    } else if (sort === 'price_desc') {
      filtered.sort((a, b) => b.salePricePaise - a.salePricePaise);
    } else if (sort === 'name_asc') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      filtered.sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || a.name.localeCompare(b.name));
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const paged = filtered.slice((page - 1) * limit, page * limit);

    res.json({
      medicines: paged,
      total,
      page,
      totalPages,
      typoSuggestedQuery,
      facets,
    });
  });

  router.post('/catalog/medicines/by-ids', (req, res) => {
    const parsed = z.object({ ids: z.array(z.string()).max(20) }).safeParse(req.body);
    if (!parsed.success || parsed.data.ids.length === 0) {
      res.json({ medicines: [] });
      return;
    }
    const store = getPublicStoreInfo();
    const placeholders = parsed.data.ids.map(() => '?').join(',');
    const rows = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         WHERE m.id IN (${placeholders}) AND m.business_id = ? AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'`
      )
      .all(store.id, store.id, ...parsed.data.ids, store.businessId) as Array<Record<string, unknown>>;

    const map = new Map(rows.map((r) => [r.id as string, buildMedicineDTO(r)]));
    const ordered = parsed.data.ids.map((id) => map.get(id)).filter((x): x is MedicineDTO => Boolean(x));
    res.json({ medicines: ordered });
  });

  router.get('/catalog/medicines/:slug', (req, res) => {
    const store = getPublicStoreInfo();
    const r = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         WHERE m.slug = ? AND m.business_id = ? AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'`
      )
      .get(store.id, store.id, req.params.slug, store.businessId) as Record<string, unknown> | undefined;

    if (!r) {
      res.status(404).json({ error: 'Medicine not found or pending pharmacist approval' });
      return;
    }

    const imgRows = sqlite
      .prepare('SELECT id, image_url, alt_text, is_primary, sort_order FROM medicine_images WHERE medicine_id = ? ORDER BY sort_order ASC')
      .all(r.id as string) as Array<Record<string, unknown>>;

    const images: MedicineImageDTO[] = imgRows.map((im) => ({
      id: im.id as string,
      imageUrl: im.image_url as string,
      altText: im.alt_text as string,
      isPrimary: Boolean(im.is_primary),
      sortOrder: Number(im.sort_order),
    }));

    res.json({ medicine: buildMedicineDTO(r, images) });
  });

  // Request Availability for Unavailable / Unlisted Medicines
  router.post('/catalog/request-availability', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        medicineId: z.string().optional(),
        medicineName: z.string().trim().min(2).max(160),
        requesterName: z.string().trim().min(2).max(100),
        requesterPhone: z.string().trim().min(10).max(16),
        notes: z.string().trim().max(400).optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Please provide medicine name, your name, and phone number' });
      return;
    }

    const store = getPublicStoreInfo();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    sqlite
      .prepare(
        `INSERT INTO availability_requests (id, store_id, user_id, medicine_id, medicine_name, requester_name, requester_phone, notes, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`
      )
      .run(
        id,
        store.id,
        req.auth?.userId || null,
        parsed.data.medicineId || null,
        parsed.data.medicineName,
        parsed.data.requesterName,
        parsed.data.requesterPhone,
        parsed.data.notes || null,
        now
      );

    res.status(201).json({ ok: true, requestId: id });
  });

  // Contact Pharmacist Inquiry (Product Question)
  router.post('/pharmacist-question', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        medicineName: z.string().trim().min(2).max(140),
        name: z.string().trim().min(2).max(100),
        phone: z.string().trim().min(10).max(16),
        question: z.string().trim().min(5).max(800),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please enter your name, phone, and question for the pharmacist' });
      return;
    }

    const store = getPublicStoreInfo();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO support_tickets (id, store_id, user_id, name, phone, subject, message, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`
      )
      .run(
        id,
        store.id,
        req.auth?.userId || null,
        parsed.data.name,
        parsed.data.phone,
        `Pharmacist Question: ${parsed.data.medicineName}`,
        parsed.data.question,
        now,
        now
      );

    res.status(201).json({ ok: true, ticketId: id });
  });

  // Cart & Save-for-Later Endpoints
  router.get('/cart', (req: AuthenticatedRequest, res) => {
    const store = getPublicStoreInfo();
    const cartId = getOrCreateCartId(req, res, store.id);
    res.json(buildCartDTO(cartId, store.id, req));
  });

  router.post('/cart/items', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        medicineId: z.string().min(1),
        quantity: z.number().int().min(1).max(25),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid cart item payload' });
      return;
    }

    const store = getPublicStoreInfo();
    const cartId = getOrCreateCartId(req, res, store.id);
    const now = new Date().toISOString();

    const row = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         WHERE m.id = ? AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'`
      )
      .get(store.id, store.id, parsed.data.medicineId) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Medicine not found' });
      return;
    }

    const medDto = buildMedicineDTO(row);
    if (!medDto.canPurchase) {
      res.status(400).json({ error: medDto.unavailableReason || 'Product cannot be purchased online' });
      return;
    }

    const existing = sqlite
      .prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND medicine_id = ?')
      .get(cartId, parsed.data.medicineId) as { id: string; quantity: number } | undefined;

    const requestedTotal = (existing?.quantity || 0) + parsed.data.quantity;
    if (requestedTotal > medDto.availableStock) {
      res.status(400).json({ error: `Only ${medDto.availableStock} unexpired packs available in store` });
      return;
    }

    if (existing) {
      const nextQty = Math.min(25, requestedTotal);
      sqlite
        .prepare('UPDATE cart_items SET quantity = ?, updated_at = ? WHERE id = ?')
        .run(nextQty, now, existing.id);
    } else {
      sqlite
        .prepare(
          'INSERT INTO cart_items (id, cart_id, medicine_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(crypto.randomUUID(), cartId, parsed.data.medicineId, parsed.data.quantity, now, now);
    }

    res.json(buildCartDTO(cartId, store.id, req));
  });

  router.patch('/cart/items/:medicineId', (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ quantity: z.number().int().min(0).max(25) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid quantity' });
      return;
    }

    const store = getPublicStoreInfo();
    const cartId = getOrCreateCartId(req, res, store.id);
    if (parsed.data.quantity === 0) {
      sqlite
        .prepare('DELETE FROM cart_items WHERE cart_id = ? AND medicine_id = ?')
        .run(cartId, req.params.medicineId);
    } else {
      const stockRow = sqlite
        .prepare(
          "SELECT COALESCE(SUM(quantity_available), 0) as stock FROM medicine_batches WHERE medicine_id = ? AND store_id = ? AND expiry_date > date('now')"
        )
        .get(req.params.medicineId, store.id) as { stock: number };
      if (parsed.data.quantity > stockRow.stock) {
        res.status(400).json({ error: `Only ${stockRow.stock} packs available` });
        return;
      }
      sqlite
        .prepare('UPDATE cart_items SET quantity = ?, updated_at = ? WHERE cart_id = ? AND medicine_id = ?')
        .run(parsed.data.quantity, new Date().toISOString(), cartId, req.params.medicineId);
    }
    res.json(buildCartDTO(cartId, store.id, req));
  });

  router.delete('/cart/items/:medicineId', (req: AuthenticatedRequest, res) => {
    const store = getPublicStoreInfo();
    const cartId = getOrCreateCartId(req, res, store.id);
    sqlite.prepare('DELETE FROM cart_items WHERE cart_id = ? AND medicine_id = ?').run(cartId, req.params.medicineId);
    res.json(buildCartDTO(cartId, store.id, req));
  });

  router.post('/cart/save-for-later/:medicineId', (req: AuthenticatedRequest, res) => {
    const store = getPublicStoreInfo();
    const cartId = getOrCreateCartId(req, res, store.id);
    const guestKey = req.cookies?.[GUEST_CART_COOKIE_NAME] || null;
    const now = new Date().toISOString();

    databaseService.withTransaction(() => {
      sqlite.prepare('DELETE FROM cart_items WHERE cart_id = ? AND medicine_id = ?').run(cartId, req.params.medicineId);
      const exists = req.auth
        ? sqlite
            .prepare("SELECT id FROM saved_items WHERE user_id = ? AND medicine_id = ? AND list_type = 'CART_SAVED'")
            .get(req.auth.userId, req.params.medicineId)
        : guestKey
          ? sqlite
              .prepare("SELECT id FROM saved_items WHERE guest_key = ? AND medicine_id = ? AND list_type = 'CART_SAVED'")
              .get(guestKey, req.params.medicineId)
          : undefined;
      if (!exists) {
        sqlite
          .prepare('INSERT INTO saved_items (id, user_id, guest_key, medicine_id, list_type, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), req.auth?.userId || null, req.auth ? null : guestKey, req.params.medicineId, 'CART_SAVED', now);
      }
    });

    res.json(buildCartDTO(cartId, store.id, req));
  });

  router.post('/cart/move-to-cart/:medicineId', (req: AuthenticatedRequest, res) => {
    const store = getPublicStoreInfo();
    const cartId = getOrCreateCartId(req, res, store.id);
    const guestKey = req.cookies?.[GUEST_CART_COOKIE_NAME] || null;
    const now = new Date().toISOString();

    const row = sqlite
      .prepare(`${BASE_MEDICINE_SELECT} WHERE m.id = ? AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'`)
      .get(store.id, store.id, req.params.medicineId) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Medicine not found' });
      return;
    }
    const med = buildMedicineDTO(row);
    if (!med.canPurchase) {
      res.status(400).json({ error: med.unavailableReason || 'Item unavailable' });
      return;
    }

    databaseService.withTransaction(() => {
      if (req.auth) {
        sqlite
          .prepare("DELETE FROM saved_items WHERE user_id = ? AND medicine_id = ? AND list_type = 'CART_SAVED'")
          .run(req.auth.userId, req.params.medicineId);
      } else if (guestKey) {
        sqlite
          .prepare("DELETE FROM saved_items WHERE guest_key = ? AND medicine_id = ? AND list_type = 'CART_SAVED'")
          .run(guestKey, req.params.medicineId);
      }
      const existing = sqlite
        .prepare('SELECT id FROM cart_items WHERE cart_id = ? AND medicine_id = ?')
        .get(cartId, req.params.medicineId) as { id: string } | undefined;
      if (!existing) {
        sqlite
          .prepare('INSERT INTO cart_items (id, cart_id, medicine_id, quantity, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
          .run(crypto.randomUUID(), cartId, req.params.medicineId, now, now);
      }
    });

    res.json(buildCartDTO(cartId, store.id, req));
  });

  // Saved Wishlist Items (Account)
  router.get('/saved-items', requireAuth, (req: AuthenticatedRequest, res) => {
    const store = getPublicStoreInfo();
    const rows = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         JOIN saved_items si ON si.medicine_id = m.id
         WHERE si.user_id = ? AND si.list_type = 'WISHLIST' AND m.is_active = 1 AND m.is_pharmacist_approved = 1
         ORDER BY si.created_at DESC`
      )
      .all(store.id, store.id, req.auth!.userId) as Array<Record<string, unknown>>;
    res.json({ medicines: rows.map((r) => buildMedicineDTO(r)) });
  });

  router.post('/saved-items', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = z.object({ medicineId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Medicine ID required' });
      return;
    }
    const existing = sqlite
      .prepare("SELECT id FROM saved_items WHERE user_id = ? AND medicine_id = ? AND list_type = 'WISHLIST'")
      .get(req.auth!.userId, parsed.data.medicineId);
    if (!existing) {
      sqlite
        .prepare('INSERT INTO saved_items (id, user_id, medicine_id, list_type, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), req.auth!.userId, parsed.data.medicineId, 'WISHLIST', new Date().toISOString());
    }
    res.json({ ok: true });
  });

  router.delete('/saved-items/:medicineId', requireAuth, (req: AuthenticatedRequest, res) => {
    sqlite
      .prepare("DELETE FROM saved_items WHERE user_id = ? AND medicine_id = ? AND list_type = 'WISHLIST'")
      .run(req.auth!.userId, req.params.medicineId);
    res.json({ ok: true });
  });

  // Addresses (Full Prompt 2 fields)
  router.get('/addresses', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = sqlite
      .prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
      .all(req.auth!.userId);
    res.json({ addresses: rows });
  });

  router.post('/addresses', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        label: z.string().trim().min(2).max(40),
        recipientName: z.string().trim().min(2).max(100),
        phone: z.string().trim().min(10).max(16),
        flatBuilding: z.string().trim().min(1).max(100).optional(),
        societyName: z.string().trim().max(120).optional(),
        street: z.string().trim().max(160).optional(),
        line1: z.string().trim().min(3).max(200).optional(),
        line2: z.string().trim().max(200).optional(),
        landmark: z.string().trim().max(120).optional(),
        city: z.string().trim().min(2).max(80).default('Mira Road East'),
        state: z.string().trim().min(2).max(80).default('Maharashtra'),
        postalCode: z.string().trim().min(5).max(10).default('401107'),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        isDefault: z.boolean().optional().default(false),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid address fields', issues: parsed.error.flatten() });
      return;
    }

    const d = parsed.data;
    const composedLine1 =
      d.line1 ||
      [d.flatBuilding, d.societyName, d.street]
        .filter(Boolean)
        .join(', ');

    if (!composedLine1) {
      res.status(400).json({ error: 'Flat/building and street details are required' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    databaseService.withTransaction(() => {
      if (d.isDefault) {
        sqlite.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.auth!.userId);
      }
      sqlite
        .prepare(
          `INSERT INTO addresses (
            id, user_id, label, recipient_name, phone, flat_building, society_name, street,
            line1, line2, landmark, city, state, postal_code, latitude, longitude, is_default, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          req.auth!.userId,
          d.label,
          d.recipientName,
          d.phone,
          d.flatBuilding || null,
          d.societyName || null,
          d.street || null,
          composedLine1,
          d.line2 || d.societyName || null,
          d.landmark || null,
          d.city,
          d.state,
          d.postalCode,
          d.latitude ?? 19.2845 + (Math.random() - 0.5) * 0.01,
          d.longitude ?? 72.8745 + (Math.random() - 0.5) * 0.01,
          d.isDefault ? 1 : 0,
          now,
          now
        );
    });

    const address = sqlite.prepare('SELECT * FROM addresses WHERE id = ?').get(id);
    res.status(201).json({ address });
  });

  router.delete('/addresses/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    sqlite.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(req.params.id, req.auth!.userId);
    res.json({ ok: true });
  });

  // Coupon Validation
  router.post('/coupons/validate', (req, res) => {
    const parsed = z
      .object({
        code: z.string().trim().min(2),
        subtotalPaise: z.number().int().min(0),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid coupon request' });
      return;
    }

    const coupon = sqlite
      .prepare('SELECT * FROM coupons WHERE upper(code) = upper(?) AND is_active = 1')
      .get(parsed.data.code) as Record<string, unknown> | undefined;

    if (!coupon) {
      res.status(404).json({ error: 'Coupon code not found or expired' });
      return;
    }

    if (parsed.data.subtotalPaise < Number(coupon.min_order_paise)) {
      res.status(400).json({
        error: `Minimum order value of ₹${Math.round(Number(coupon.min_order_paise) / 100)} required for ${coupon.code}`,
      });
      return;
    }

    let discountPaise =
      coupon.discount_type === 'PERCENT'
        ? Math.round((parsed.data.subtotalPaise * Number(coupon.discount_value)) / 100)
        : Number(coupon.discount_value);

    if (coupon.max_discount_paise) {
      discountPaise = Math.min(discountPaise, Number(coupon.max_discount_paise));
    }

    res.json({
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discountPaise,
      },
    });
  });

  // Payment Gateway: Razorpay Order Creation, Signature Verification, Failure Logging & Retry
  router.post('/payments/razorpay/create-order', requireAuth, async (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        orderId: z.string().optional(),
        couponCode: z.string().optional(),
        fulfillmentType: z.enum([FulfillmentType.DELIVERY, FulfillmentType.STORE_PICKUP]).optional(),
        addressId: z.string().optional(),
        method: z
          .enum([PaymentMethod.RAZORPAY_TEST, PaymentMethod.UPI, PaymentMethod.CARD, PaymentMethod.NETBANKING])
          .optional()
          .default(PaymentMethod.RAZORPAY_TEST),
      })
      .safeParse(req.body || {});

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid Razorpay order payload' });
      return;
    }

    const store = getPublicStoreInfo();

    // Case A: Paying for an existing order (e.g. post-pharmacist approval or payment retry)
    if (parsed.data.orderId) {
      const order = sqlite
        .prepare('SELECT id, order_number, total_paise, prescription_status, payment_status, status FROM orders WHERE id = ? AND user_id = ?')
        .get(parsed.data.orderId, req.auth!.userId) as
        | { id: string; order_number: string; total_paise: number; prescription_status: string; payment_status: string; status: string }
        | undefined;
      if (!order) {
        res.status(404).json({ error: 'Order not found', code: 'NOT_FOUND' });
        return;
      }
      if (order.prescription_status !== PrescriptionStatus.APPROVED && order.prescription_status !== PrescriptionStatus.NOT_REQUIRED) {
        res.status(403).json({ error: 'Online payment is locked until the registered pharmacist approves your prescription', code: 'RX_REJECTED' });
        return;
      }
      if (order.payment_status === PaymentStatus.PAID) {
        res.status(409).json({ error: 'This order is already paid' });
        return;
      }

      const gatewayOrder = await paymentGatewayService.createGatewayOrder({
        storeId: store.id,
        userId: req.auth!.userId,
        orderId: order.id,
        amountPaise: order.total_paise,
        method: parsed.data.method,
        receipt: order.order_number,
      });

      sqlite
        .prepare('UPDATE payments SET gateway_order_id = ?, method = ?, updated_at = ? WHERE order_id = ?')
        .run(gatewayOrder.gatewayOrderId, parsed.data.method, new Date().toISOString(), order.id);

      res.json(gatewayOrder);
      return;
    }

    // Case B: Pre-checkout payment initiation strictly from server cart calculation
    const cartId = getOrCreateCartId(req, res, store.id);
    const cart = buildCartDTO(cartId, store.id, req);
    if (cart.items.length === 0) {
      res.status(400).json({ error: 'Your cart is empty', code: 'STOCK_CHANGED' });
      return;
    }

    let pinFee = store.deliveryFeePaise;
    if (parsed.data.fulfillmentType !== FulfillmentType.STORE_PICKUP && parsed.data.addressId) {
      const addr = sqlite
        .prepare('SELECT postal_code FROM addresses WHERE id = ? AND user_id = ?')
        .get(parsed.data.addressId, req.auth!.userId) as { postal_code: string } | undefined;
      if (addr) {
        const pin = sqlite
          .prepare('SELECT delivery_fee_paise FROM serviceable_pincodes WHERE store_id = ? AND pincode = ? AND is_active = 1')
          .get(store.id, addr.postal_code) as { delivery_fee_paise: number } | undefined;
        if (pin) pinFee = pin.delivery_fee_paise;
      }
    }

    let discountPaise = 0;
    if (parsed.data.couponCode) {
      const coupon = sqlite
        .prepare('SELECT * FROM coupons WHERE upper(code) = upper(?) AND is_active = 1')
        .get(parsed.data.couponCode) as Record<string, unknown> | undefined;
      if (coupon && cart.subtotalPaise >= Number(coupon.min_order_paise)) {
        discountPaise =
          coupon.discount_type === 'PERCENT'
            ? Math.round((cart.subtotalPaise * Number(coupon.discount_value)) / 100)
            : Number(coupon.discount_value);
        if (coupon.max_discount_paise) discountPaise = Math.min(discountPaise, Number(coupon.max_discount_paise));
      }
    }

    const deliveryFeePaise =
      parsed.data.fulfillmentType === FulfillmentType.STORE_PICKUP || cart.subtotalPaise >= store.freeDeliveryThresholdPaise
        ? 0
        : pinFee;
    const totalPaise = Math.max(100, cart.subtotalPaise - discountPaise + deliveryFeePaise);

    const gatewayOrder = await paymentGatewayService.createGatewayOrder({
      storeId: store.id,
      userId: req.auth!.userId,
      amountPaise: totalPaise,
      method: parsed.data.method,
      receipt: `CART-${cartId.slice(0, 8)}`,
    });

    res.json(gatewayOrder);
  });

  // Test-mode sandbox callback helper (never enabled if live Razorpay mode is active)
  router.post('/payments/razorpay/test-simulate-auth', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        gatewayOrderId: z.string().min(6),
        outcome: z.enum(['SUCCESS', 'FAILED']).default('SUCCESS'),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'gatewayOrderId required' });
      return;
    }

    const store = getPublicStoreInfo();
    const live = paymentGatewayService.isLiveModeAllowed(store.id);
    if (live.allowed) {
      res.status(403).json({ error: 'Test payment simulator is disabled in live production mode', code: 'COMPLIANCE_BLOCKED' });
      return;
    }

    if (parsed.data.outcome === 'FAILED') {
      res.json({
        outcome: 'FAILED',
        errorCode: 'PAYMENT_FAILED',
        reason: 'Simulated UPI / bank authorization decline (Test Mode)',
      });
      return;
    }

    const gatewayPaymentId = `pay_slm_test_${crypto.randomBytes(6).toString('hex')}`;
    const signature = paymentGatewayService.generateTestSignature(parsed.data.gatewayOrderId, gatewayPaymentId);
    res.json({
      outcome: 'SUCCESS',
      gatewayOrderId: parsed.data.gatewayOrderId,
      gatewayPaymentId,
      signature,
    });
  });

  // Verify Razorpay Signature for an existing order & mark PAID (supports retries)
  router.post('/payments/razorpay/verify', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        orderId: z.string().min(1),
        gatewayOrderId: z.string().min(4),
        gatewayPaymentId: z.string().min(4),
        signature: z.string().min(16),
        method: z
          .enum([PaymentMethod.RAZORPAY_TEST, PaymentMethod.UPI, PaymentMethod.CARD, PaymentMethod.NETBANKING])
          .optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Payment verification details incomplete', code: 'PAYMENT_FAILED' });
      return;
    }

    const order = sqlite
      .prepare('SELECT id, store_id, user_id, order_number, total_paise, status, prescription_status, payment_status FROM orders WHERE id = ? AND user_id = ?')
      .get(parsed.data.orderId, req.auth!.userId) as
      | {
          id: string;
          store_id: string;
          user_id: string;
          order_number: string;
          total_paise: number;
          status: string;
          prescription_status: string;
          payment_status: string;
        }
      | undefined;

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (order.prescription_status !== PrescriptionStatus.APPROVED && order.prescription_status !== PrescriptionStatus.NOT_REQUIRED) {
      res.status(403).json({ error: 'Online payment locked until pharmacist approves prescription', code: 'RX_REJECTED' });
      return;
    }

    const verified = paymentGatewayService.verifySignature({
      gatewayOrderId: parsed.data.gatewayOrderId,
      gatewayPaymentId: parsed.data.gatewayPaymentId,
      signature: parsed.data.signature,
    });
    if (!verified) {
      sqlite
        .prepare('UPDATE payments SET status = ?, failure_reason = ?, updated_at = ? WHERE order_id = ?')
        .run(PaymentStatus.FAILED, 'Invalid Razorpay HMAC SHA-256 signature', new Date().toISOString(), order.id);
      sqlite
        .prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?')
        .run(PaymentStatus.FAILED, new Date().toISOString(), order.id);
      res.status(400).json({ error: 'Payment signature verification failed. Amount was not captured.', code: 'PAYMENT_FAILED' });
      return;
    }

    const now = new Date().toISOString();
    const payMethod = parsed.data.method || PaymentMethod.RAZORPAY_TEST;

    databaseService.withTransaction(() => {
      sqlite
        .prepare('UPDATE orders SET payment_method = ?, payment_status = ?, updated_at = ? WHERE id = ?')
        .run(payMethod, PaymentStatus.PAID, now, order.id);

      sqlite
        .prepare(
          `UPDATE payments
           SET method = ?, status = ?, gateway_order_id = ?, gateway_payment_id = ?,
               provider_reference = ?, signature_verified = 1, failure_reason = NULL, paid_at = ?, updated_at = ?
           WHERE order_id = ?`
        )
        .run(
          payMethod,
          PaymentStatus.PAID,
          parsed.data.gatewayOrderId,
          parsed.data.gatewayPaymentId,
          parsed.data.gatewayPaymentId,
          now,
          now,
          order.id
        );
    });

    if (order.status === OrderStatus.PAYMENT_PENDING || order.status === OrderStatus.ORDER_RECEIVED) {
      orderLifecycleService.transition({
        orderId: order.id,
        storeId: order.store_id,
        nextStatus: OrderStatus.CONFIRMED,
        actorUserId: req.auth!.userId,
        note: `Online payment verified (${parsed.data.gatewayPaymentId})`,
      });
    }

    void notificationService.notify({
      userId: order.user_id,
      orderId: order.id,
      template: 'PAYMENT_RECEIVED',
      variables: {
        orderNumber: order.order_number,
        amountFormatted: `₹${(order.total_paise / 100).toFixed(2)}`,
        reference: parsed.data.gatewayPaymentId,
      },
    });

    realtimeService.emitEvent({
      event: 'payment.updated',
      orderId: order.id,
      storeId: order.store_id,
      payload: {
        orderId: order.id,
        paymentStatus: PaymentStatus.PAID,
        method: payMethod,
        reference: parsed.data.gatewayPaymentId,
      },
    });

    res.json({ ok: true, paymentReference: parsed.data.gatewayPaymentId, signatureVerified: true });
  });

  // Record a payment failure without losing the order so customer can retry
  router.post('/payments/razorpay/failure', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        orderId: z.string().min(1),
        reason: z.string().trim().max(240).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'orderId required' });
      return;
    }
    const order = sqlite
      .prepare('SELECT id, payment_status FROM orders WHERE id = ? AND user_id = ?')
      .get(parsed.data.orderId, req.auth!.userId) as { id: string; payment_status: string } | undefined;
    if (!order || order.payment_status === PaymentStatus.PAID) {
      res.status(400).json({ error: 'Order cannot be marked failed' });
      return;
    }
    const now = new Date().toISOString();
    const reason = sanitizeTextInput(parsed.data.reason || 'Payment declined or cancelled by user');
    databaseService.withTransaction(() => {
      sqlite.prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?').run(PaymentStatus.FAILED, now, order.id);
      sqlite
        .prepare('UPDATE payments SET status = ?, failure_reason = ?, updated_at = ? WHERE order_id = ?')
        .run(PaymentStatus.FAILED, reason, now, order.id);
    });
    res.json({ ok: true, paymentStatus: PaymentStatus.FAILED, reason });
  });

  // Checkout / Place Order (Server-validated pricing, serviceability, Rx gating, concurrency safe & Razorpay HMAC verified)
  router.post('/orders', requireAuth, (req: AuthenticatedRequest, res) => {
    const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'].trim() : '';
    if (idempotencyKey) {
      const prior = sqlite
        .prepare('SELECT response_status, response_json FROM idempotency_keys WHERE key = ? AND user_id = ?')
        .get(idempotencyKey, req.auth!.userId) as { response_status: number; response_json: string } | undefined;
      if (prior) {
        res.status(prior.response_status).json(JSON.parse(prior.response_json));
        return;
      }
    }

    const parsed = z
      .object({
        fulfillmentType: z
          .enum([FulfillmentType.DELIVERY, FulfillmentType.STORE_PICKUP])
          .optional()
          .default(FulfillmentType.DELIVERY),
        addressId: z.string().optional(),
        paymentMethod: z.enum([
          PaymentMethod.RAZORPAY_TEST,
          PaymentMethod.UPI,
          PaymentMethod.CARD,
          PaymentMethod.NETBANKING,
          PaymentMethod.CASH_ON_DELIVERY,
        ]),
        paymentReference: z.string().trim().max(120).optional(),
        gatewayOrderId: z.string().trim().max(120).optional(),
        gatewayPaymentId: z.string().trim().max(120).optional(),
        paymentSignature: z.string().trim().max(200).optional(),
        couponCode: z.string().optional(),
        prescriptionId: z.string().optional(),
        deliveryNotes: z.string().max(300).optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid checkout details', issues: parsed.error.flatten() });
      return;
    }

    const store = getPublicStoreInfo();
    const cartId = getOrCreateCartId(req, res, store.id);
    const cart = buildCartDTO(cartId, store.id, req);

    if (cart.items.length === 0) {
      res.status(400).json({ error: 'Your cart is empty', code: 'STOCK_CHANGED' });
      return;
    }

    if (store.minimumOrderPaise > 0 && cart.subtotalPaise < store.minimumOrderPaise) {
      res.status(400).json({
        error: `Minimum order value is ₹${Math.round(store.minimumOrderPaise / 100)}`,
      });
      return;
    }

    const invalidItems = cart.items.filter((it) => !it.canPurchase);
    if (invalidItems.length > 0) {
      res.status(400).json({
        error: `${invalidItems[0].name} is currently unavailable, out of stock, or restricted from online doorstep purchase`,
        code: 'PRODUCT_UNAVAILABLE',
      });
      return;
    }

    let addressRow: { id: string; postal_code: string } | undefined;
    let pinDeliveryFeePaise = store.deliveryFeePaise;

    if (parsed.data.fulfillmentType === FulfillmentType.DELIVERY) {
      if (!parsed.data.addressId) {
        res.status(400).json({ error: 'Delivery address is required', code: 'INVALID_ADDRESS' });
        return;
      }
      addressRow = sqlite
        .prepare('SELECT id, postal_code FROM addresses WHERE id = ? AND user_id = ?')
        .get(parsed.data.addressId, req.auth!.userId) as { id: string; postal_code: string } | undefined;
      if (!addressRow) {
        res.status(400).json({ error: 'Valid delivery address is required', code: 'INVALID_ADDRESS' });
        return;
      }

      const pinRow = sqlite
        .prepare('SELECT delivery_fee_paise FROM serviceable_pincodes WHERE store_id = ? AND pincode = ? AND is_active = 1')
        .get(store.id, addressRow.postal_code) as { delivery_fee_paise: number } | undefined;
      if (!pinRow) {
        res.status(400).json({
          error: `Delivery is not serviceable for PIN code ${addressRow.postal_code}. Switch to Store Pickup or choose a Mira Road / Bhayandar PIN code.`,
          code: 'AREA_UNSERVICEABLE',
        });
        return;
      }
      pinDeliveryFeePaise = pinRow.delivery_fee_paise;
    }

    if (cart.requiresPrescription && !parsed.data.prescriptionId) {
      res.status(400).json({ error: 'A prescription upload is required for Schedule H medicines in your cart', code: 'RX_REJECTED' });
      return;
    }

    let rxRecord: { id: string; status: string } | undefined;
    if (parsed.data.prescriptionId) {
      rxRecord = sqlite
        .prepare('SELECT id, status FROM prescriptions WHERE id = ? AND user_id = ?')
        .get(parsed.data.prescriptionId, req.auth!.userId) as { id: string; status: string } | undefined;
      if (!rxRecord) {
        res.status(400).json({ error: 'Selected prescription not found', code: 'RX_REJECTED' });
        return;
      }
      if (rxRecord.status === PrescriptionStatus.REJECTED) {
        res.status(400).json({
          error: 'This prescription was rejected by the pharmacist. Please upload a valid prescription.',
          code: 'RX_REJECTED',
        });
        return;
      }
    }

    const rxApprovedAlready = !cart.requiresPrescription || rxRecord?.status === PrescriptionStatus.APPROVED;
    const isOnlinePay = parsed.data.paymentMethod !== PaymentMethod.CASH_ON_DELIVERY;

    // Never trust client payment success without cryptographic HMAC signature verification!
    let paymentSignatureVerified = false;
    if (isOnlinePay && rxApprovedAlready && parsed.data.gatewayOrderId && parsed.data.gatewayPaymentId && parsed.data.paymentSignature) {
      paymentSignatureVerified = paymentGatewayService.verifySignature({
        gatewayOrderId: parsed.data.gatewayOrderId,
        gatewayPaymentId: parsed.data.gatewayPaymentId,
        signature: parsed.data.paymentSignature,
      });
      if (!paymentSignatureVerified) {
        res.status(400).json({
          error: 'Online payment signature verification failed. Please retry payment.',
          code: 'PAYMENT_FAILED',
        });
        return;
      }
    }

    try {
      const createdOrder = databaseService.withTransaction(() => {
        const now = new Date().toISOString();
        let discountPaise = 0;
        let couponId: string | null = null;

        if (parsed.data.couponCode) {
          const coupon = sqlite
            .prepare('SELECT * FROM coupons WHERE upper(code) = upper(?) AND is_active = 1')
            .get(parsed.data.couponCode) as Record<string, unknown> | undefined;
          if (coupon && cart.subtotalPaise >= Number(coupon.min_order_paise)) {
            couponId = coupon.id as string;
            discountPaise =
              coupon.discount_type === 'PERCENT'
                ? Math.round((cart.subtotalPaise * Number(coupon.discount_value)) / 100)
                : Number(coupon.discount_value);
            if (coupon.max_discount_paise) {
              discountPaise = Math.min(discountPaise, Number(coupon.max_discount_paise));
            }
          }
        }

        const deliveryFeePaise =
          parsed.data.fulfillmentType === FulfillmentType.STORE_PICKUP || cart.subtotalPaise >= store.freeDeliveryThresholdPaise
            ? 0
            : pinDeliveryFeePaise;
        const taxPaise = cart.items.reduce((sum, item) => {
          const line = item.salePricePaise * item.quantity;
          return sum + Math.round((line * item.gstPercent) / (100 + item.gstPercent));
        }, 0);
        const totalPaise = Math.max(0, cart.subtotalPaise - discountPaise + deliveryFeePaise);

        const orderId = crypto.randomUUID();
        const orderNumber = `SLM-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 89999)}`;
        const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));

        const payStatus =
          isOnlinePay && rxApprovedAlready && paymentSignatureVerified
            ? PaymentStatus.PAID
            : PaymentStatus.PENDING;

        const initialStatus = !rxApprovedAlready
          ? OrderStatus.PRESCRIPTION_PENDING
          : isOnlinePay && payStatus !== PaymentStatus.PAID
            ? OrderStatus.PAYMENT_PENDING
            : OrderStatus.ORDER_RECEIVED;

        const rxStatus = cart.requiresPrescription
          ? (rxRecord?.status || PrescriptionStatus.PENDING_REVIEW)
          : PrescriptionStatus.NOT_REQUIRED;

        const deliveryOtpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        sqlite
          .prepare(
            `INSERT INTO orders (
              id, store_id, user_id, address_id, coupon_id, order_number, status, prescription_status,
              fulfillment_type, subtotal_paise, discount_paise, delivery_fee_paise, tax_paise, total_paise,
              payment_method, payment_status, delivery_notes, delivery_otp, delivery_otp_expires_at,
              is_demo_data, production_mode, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            orderId,
            store.id,
            req.auth!.userId,
            addressRow?.id || null,
            couponId,
            orderNumber,
            initialStatus,
            rxStatus,
            parsed.data.fulfillmentType,
            cart.subtotalPaise,
            discountPaise,
            deliveryFeePaise,
            taxPaise,
            totalPaise,
            parsed.data.paymentMethod,
            payStatus,
            parsed.data.deliveryNotes ? sanitizeTextInput(parsed.data.deliveryNotes) : null,
            deliveryOtp,
            deliveryOtpExpiresAt,
            store.demoMode ? 1 : 0,
            store.productionSalesEnabled ? 1 : 0,
            now,
            now
          );

        for (const item of cart.items) {
          const batches = sqlite
            .prepare(
              `SELECT id, quantity_available FROM medicine_batches
               WHERE store_id = ? AND medicine_id = ? AND quantity_available > 0 AND expiry_date > date('now') AND COALESCE(is_quarantined, 0) = 0
               ORDER BY expiry_date ASC`
            )
            .all(store.id, item.medicineId) as Array<{ id: string; quantity_available: number }>;

          let remaining = item.quantity;
          let primaryBatchId: string | null = null;
          for (const b of batches) {
            if (remaining <= 0) break;
            if (!primaryBatchId) primaryBatchId = b.id;
            const take = Math.min(remaining, b.quantity_available);
            const updatedBatch = sqlite
              .prepare(
                'UPDATE medicine_batches SET quantity_available = quantity_available - ?, updated_at = ? WHERE id = ? AND quantity_available >= ?'
              )
              .run(take, now, b.id, take);
            if (updatedBatch.changes === 0) {
              throw new Error(`Stock changed concurrently for ${item.name}`);
            }
            sqlite
              .prepare(
                `INSERT INTO inventory_transactions (id, store_id, batch_id, txn_type, quantity_delta, reference_type, reference_id, notes, performed_by_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                crypto.randomUUID(),
                store.id,
                b.id,
                'SALE_DISPATCH',
                -take,
                'ORDER',
                orderNumber,
                `Allocated for order ${orderNumber}`,
                req.auth!.userId,
                now
              );
            remaining -= take;
          }

          if (remaining > 0) {
            throw new Error(`Insufficient unexpired stock for ${item.name}`);
          }

          const lineTotal = item.salePricePaise * item.quantity;
          const itemTax = Math.round((lineTotal * item.gstPercent) / (100 + item.gstPercent));
          sqlite
            .prepare(
              `INSERT INTO order_items (id, order_id, medicine_id, batch_id, medicine_name, pack_size, quantity, unit_price_paise, mrp_paise, tax_paise, line_total_paise, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              crypto.randomUUID(),
              orderId,
              item.medicineId,
              primaryBatchId,
              item.name,
              item.packSize,
              item.quantity,
              item.salePricePaise,
              item.mrpPaise,
              itemTax,
              lineTotal,
              now
            );
        }

        if (parsed.data.prescriptionId) {
          sqlite
            .prepare('UPDATE prescriptions SET order_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
            .run(orderId, now, parsed.data.prescriptionId, req.auth!.userId);
        }

        sqlite
          .prepare(
            'INSERT INTO order_status_history (id, order_id, status, note, changed_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(
            crypto.randomUUID(),
            orderId,
            initialStatus,
            rxApprovedAlready
              ? `Order received (${parsed.data.fulfillmentType === FulfillmentType.STORE_PICKUP ? 'Store Pickup' : 'Home Delivery'})`
              : 'Submitted for pharmacist prescription review; online payment unlocked upon approval',
            req.auth!.userId,
            now
          );

        sqlite
          .prepare(
            `INSERT INTO payments (
              id, order_id, method, status, amount_paise, provider_reference,
              gateway_order_id, gateway_payment_id, signature_verified, idempotency_key, paid_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            orderId,
            parsed.data.paymentMethod,
            payStatus,
            totalPaise,
            payStatus === PaymentStatus.PAID ? (parsed.data.gatewayPaymentId || parsed.data.paymentReference || null) : null,
            parsed.data.gatewayOrderId || null,
            parsed.data.gatewayPaymentId || null,
            paymentSignatureVerified ? 1 : 0,
            idempotencyKey || null,
            payStatus === PaymentStatus.PAID ? now : null,
            now,
            now
          );

        sqlite
          .prepare(
            `INSERT INTO invoices (id, order_id, invoice_number, subtotal_paise, tax_paise, discount_paise, total_paise, issued_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(crypto.randomUUID(), orderId, `INV-${orderNumber}`, cart.subtotalPaise, taxPaise, discountPaise, totalPaise, now);

        sqlite.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cartId);

        sqlite
          .prepare(
            `INSERT INTO audit_logs (id, business_id, store_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            store.businessId,
            store.id,
            req.auth!.userId,
            'ORDER_CREATED',
            'Order',
            orderId,
            JSON.stringify({ orderNumber, totalPaise, fulfillmentType: parsed.data.fulfillmentType }),
            now
          );

        const responseObj = { id: orderId, orderNumber, status: initialStatus, paymentStatus: payStatus, totalPaise };
        if (idempotencyKey) {
          sqlite
            .prepare(
              'INSERT OR IGNORE INTO idempotency_keys (key, user_id, endpoint, response_status, response_json, created_at) VALUES (?, ?, ?, 201, ?, ?)'
            )
            .run(idempotencyKey, req.auth!.userId, '/api/orders', JSON.stringify({ order: responseObj }), now);
        }

        return { ...responseObj, deliveryOtp };
      });

      void notificationService.notify({
        userId: req.auth!.userId,
        orderId: createdOrder.id,
        template: 'ORDER_RECEIVED',
        variables: {
          orderNumber: createdOrder.orderNumber,
          totalFormatted: `₹${(createdOrder.totalPaise / 100).toFixed(2)}`,
        },
      });
      void notificationService.notify({
        userId: req.auth!.userId,
        orderId: createdOrder.id,
        template: 'DELIVERY_OTP',
        variables: {
          orderNumber: createdOrder.orderNumber,
          otp: createdOrder.deliveryOtp,
        },
      });

      const createdPayload = {
        orderId: createdOrder.id,
        orderNumber: createdOrder.orderNumber,
        status: createdOrder.status,
      };
      realtimeService.emitOrderUpdate(createdOrder.id, store.id, createdPayload);
      realtimeService.emitEvent({
        event: 'order.created',
        orderId: createdOrder.id,
        storeId: store.id,
        userId: req.auth!.userId,
        payload: { ...createdPayload, totalPaise: createdOrder.totalPaise },
      });

      res.status(201).json({
        order: {
          id: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          status: createdOrder.status,
          paymentStatus: createdOrder.paymentStatus,
          totalPaise: createdOrder.totalPaise,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Checkout failed';
      res.status(409).json({ error: msg, code: 'STOCK_CHANGED' });
    }
  });

  // Legacy-compatible Razorpay Test Payment endpoint delegating to signed gateway verification
  router.post('/orders/:id/razorpay-test-pay', requireAuth, async (req: AuthenticatedRequest, res) => {
    const order = sqlite
      .prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.auth!.userId) as Record<string, unknown> | undefined;

    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (order.prescription_status !== PrescriptionStatus.APPROVED && order.prescription_status !== PrescriptionStatus.NOT_REQUIRED) {
      res.status(403).json({ error: 'Online payment is locked until the pharmacist approves your prescription', code: 'RX_REJECTED' });
      return;
    }
    if (order.payment_status === PaymentStatus.PAID) {
      res.json({ ok: true, paymentReference: 'Already paid' });
      return;
    }

    const gwOrder = await paymentGatewayService.createGatewayOrder({
      storeId: String(order.store_id),
      userId: req.auth!.userId,
      orderId: String(order.id),
      amountPaise: Number(order.total_paise),
      method: PaymentMethod.RAZORPAY_TEST,
      receipt: String(order.order_number),
    });

    const gatewayPaymentId = `pay_slm_test_${crypto.randomBytes(6).toString('hex')}`;
    const sig = paymentGatewayService.generateTestSignature(gwOrder.gatewayOrderId, gatewayPaymentId);
    const verified = paymentGatewayService.verifySignature({
      gatewayOrderId: gwOrder.gatewayOrderId,
      gatewayPaymentId,
      signature: sig,
    });
    if (!verified) {
      res.status(400).json({ error: 'Signature verification failed', code: 'PAYMENT_FAILED' });
      return;
    }

    const now = new Date().toISOString();
    databaseService.withTransaction(() => {
      sqlite
        .prepare('UPDATE orders SET payment_method = ?, payment_status = ?, updated_at = ? WHERE id = ?')
        .run(PaymentMethod.RAZORPAY_TEST, PaymentStatus.PAID, now, order.id as string);

      sqlite
        .prepare(
          `UPDATE payments
           SET method = ?, status = ?, gateway_order_id = ?, gateway_payment_id = ?,
               provider_reference = ?, signature_verified = 1, paid_at = ?, updated_at = ?
           WHERE order_id = ?`
        )
        .run(
          PaymentMethod.RAZORPAY_TEST,
          PaymentStatus.PAID,
          gwOrder.gatewayOrderId,
          gatewayPaymentId,
          gatewayPaymentId,
          now,
          now,
          order.id as string
        );
    });

    if (order.status === OrderStatus.PAYMENT_PENDING || order.status === OrderStatus.ORDER_RECEIVED) {
      orderLifecycleService.transition({
        orderId: String(order.id),
        storeId: String(order.store_id),
        nextStatus: OrderStatus.CONFIRMED,
        actorUserId: req.auth!.userId,
        note: `Razorpay Test payment verified (${gatewayPaymentId})`,
      });
    }

    res.json({ ok: true, paymentReference: gatewayPaymentId, gatewayOrderId: gwOrder.gatewayOrderId });
  });

  // Reorder Subject to Live Stock, Pricing, and Pharmacist Approval
  router.post('/orders/:id/reorder', requireAuth, (req: AuthenticatedRequest, res) => {
    const order = sqlite
      .prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.auth!.userId) as { id: string } | undefined;
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const store = getPublicStoreInfo();
    const cartId = getOrCreateCartId(req, res, store.id);
    const orderItems = sqlite
      .prepare('SELECT medicine_id, medicine_name, quantity FROM order_items WHERE order_id = ?')
      .all(order.id) as Array<{ medicine_id: string; medicine_name: string; quantity: number }>;

    const added: string[] = [];
    const skipped: string[] = [];
    const now = new Date().toISOString();

    for (const item of orderItems) {
      const row = sqlite
        .prepare(`${BASE_MEDICINE_SELECT} WHERE m.id = ? AND m.is_active = 1 AND m.is_pharmacist_approved = 1 AND COALESCE(m.publication_status, 'PUBLISHED') = 'PUBLISHED'`)
        .get(store.id, store.id, item.medicine_id) as Record<string, unknown> | undefined;
      if (!row) {
        skipped.push(`${item.medicine_name} (no longer listed)`);
        continue;
      }
      const med = buildMedicineDTO(row);
      if (!med.canPurchase) {
        skipped.push(`${item.medicine_name} (${med.unavailableReason || 'unavailable'})`);
        continue;
      }
      const qtyToAdd = Math.min(item.quantity, med.availableStock);
      const existing = sqlite
        .prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND medicine_id = ?')
        .get(cartId, item.medicine_id) as { id: string; quantity: number } | undefined;
      if (existing) {
        sqlite
          .prepare('UPDATE cart_items SET quantity = ?, updated_at = ? WHERE id = ?')
          .run(Math.min(med.availableStock, existing.quantity + qtyToAdd), now, existing.id);
      } else {
        sqlite
          .prepare('INSERT INTO cart_items (id, cart_id, medicine_id, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), cartId, item.medicine_id, qtyToAdd, now, now);
      }
      added.push(med.name);
    }

    res.json({ cart: buildCartDTO(cartId, store.id, req), added, skipped });
  });

  // Customer Orders & Tracking
  router.get('/orders', requireAuth, (req: AuthenticatedRequest, res) => {
    const orders = sqlite
      .prepare(
        `SELECT o.*, a.label as address_label, a.line1 as address_line1, a.city as address_city, a.postal_code,
                i.invoice_number
         FROM orders o
         LEFT JOIN addresses a ON a.id = o.address_id
         LEFT JOIN invoices i ON i.order_id = o.id
         WHERE o.user_id = ?
         ORDER BY o.created_at DESC`
      )
      .all(req.auth!.userId) as Array<Record<string, unknown>>;

    const items = sqlite
      .prepare('SELECT * FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)')
      .all(req.auth!.userId) as Array<Record<string, unknown>>;

    res.json({
      orders: orders.map((o) => ({
        ...o,
        items: items.filter((it) => it.order_id === o.id),
      })),
    });
  });

  // Maps Platform Configurable Provider Proxy (never leaks server API key)
  router.get('/maps/config', (_req, res) => {
    res.json({
      serverApiConfigured: mapsAdapter.isConfigured(),
      clientMapKeyConfigured: Boolean(process.env.VITE_GOOGLE_MAPS_API_KEY),
    });
  });

  router.get('/maps/autocomplete', requireAuth, async (req, res) => {
    const input = String(req.query.input || '');
    const sessionToken = req.query.sessionToken ? String(req.query.sessionToken) : undefined;
    const out = await mapsAdapter.autocompletePlaces(input, sessionToken);
    res.json(out);
  });

  router.get('/maps/place-details', requireAuth, async (req, res) => {
    const placeId = String(req.query.placeId || '');
    const sessionToken = req.query.sessionToken ? String(req.query.sessionToken) : undefined;
    if (!placeId) {
      res.status(400).json({ error: 'placeId required' });
      return;
    }
    const out = await mapsAdapter.getPlaceDetails(placeId, sessionToken);
    res.json(out);
  });

  router.post('/maps/geocode', requireAuth, async (req, res) => {
    const address = String(req.body?.address || '');
    if (address.trim().length < 3) {
      res.status(400).json({ error: 'Address required' });
      return;
    }
    const out = await mapsAdapter.geocodeAddress(address);
    res.json(out);
  });

  async function buildTrackPayload(param: string, req: AuthenticatedRequest) {
    const order = sqlite
      .prepare(
        `SELECT o.*, a.recipient_name, a.phone as delivery_phone, a.line1, a.line2, a.landmark, a.city, a.postal_code,
                a.latitude as dest_lat, a.longitude as dest_lng, i.invoice_number
         FROM orders o
         LEFT JOIN addresses a ON a.id = o.address_id
         LEFT JOIN invoices i ON i.order_id = o.id
         WHERE o.id = ? OR upper(o.order_number) = upper(?)`
      )
      .get(param, param) as Record<string, unknown> | undefined;

    if (!order) return null;

    const store = getPublicStoreInfo();
    const items = sqlite
      .prepare('SELECT id, medicine_name, pack_size, quantity, line_total_paise FROM order_items WHERE order_id = ?')
      .all(order.id as string);
    const history = sqlite
      .prepare('SELECT id, status, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY created_at ASC')
      .all(order.id as string);

    const assignment = sqlite
      .prepare(
        `SELECT da.id, da.status, da.priority, da.assigned_at, da.accepted_at, da.arrived_at_store_at,
                da.picked_up_at, da.arrived_at_customer_at, da.delivered_at, da.failure_reason,
                dp.vehicle_type, dp.vehicle_number, dp.current_lat, dp.current_lng, dp.last_location_at,
                u.full_name as partner_full_name, u.phone as partner_phone
         FROM delivery_assignments da
         JOIN delivery_partners dp ON dp.id = da.delivery_partner_id
         JOIN users u ON u.id = dp.user_id
         WHERE da.order_id = ?`
      )
      .get(order.id as string) as Record<string, unknown> | undefined;

    const isOwner = Boolean(req.auth && req.auth.userId === order.user_id);
    const staffRoleSet = new Set<Role>([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.PHARMACIST]);
    const isStaff = Boolean(req.auth && req.auth.roles.some((r) => staffRoleSet.has(r)));
    const canSeeOtpAndContact = isOwner || isStaff;

    const isCompletedOrCancelled =
      order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED;
    const activeDispatch =
      assignment &&
      ['ACCEPTED', 'ARRIVED_AT_STORE', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_CUSTOMER'].includes(
        String(assignment.status)
      );

    // Privacy & Data Minimization: Remove customer access to live driver coordinates once delivered/cancelled
    const destLat = Number(order.dest_lat || 19.2869);
    const destLng = Number(order.dest_lng || 72.8716);
    const rawDriverLat =
      !isCompletedOrCancelled && assignment?.current_lat ? Number(assignment.current_lat) : null;
    const rawDriverLng =
      !isCompletedOrCancelled && assignment?.current_lng ? Number(assignment.current_lng) : null;

    const lastLocationAt = !isCompletedOrCancelled
      ? ((assignment?.last_location_at as string | null) || null)
      : null;
    const ageSecs = lastLocationAt
      ? Math.floor((Date.now() - new Date(lastLocationAt).getTime()) / 1000)
      : null;
    const freshnessThresholdSec = 60;
    const isLocationStale = Boolean(
      activeDispatch && (ageSecs === null || ageSecs > freshnessThresholdSec || rawDriverLat === null)
    );

    let distanceKm: number | null = null;
    let etaMinutes: number | null = null;
    let encodedPolyline: string | null = null;
    let etaUnavailableReason: string | null = null;

    if (!isCompletedOrCancelled) {
      const originLat = rawDriverLat ?? store.latitude;
      const originLng = rawDriverLng ?? store.longitude;
      const route = await mapsAdapter.computeRoute(
        { lat: originLat, lng: originLng },
        { lat: destLat, lng: destLng }
      );
      distanceKm = route.distanceKm;
      etaMinutes = route.etaMinutes;
      encodedPolyline = route.encodedPolyline;
      if (!route.available) {
        etaUnavailableReason = route.reason || 'ETA unavailable (route provider not configured)';
      }
    }

    const firstName = assignment?.partner_full_name
      ? String(assignment.partner_full_name).trim().split(/\s+/)[0]
      : null;

    const sanitizedOrder = {
      ...order,
      delivery_otp: canSeeOtpAndContact && !isCompletedOrCancelled ? order.delivery_otp : null,
      delivery_phone: canSeeOtpAndContact ? order.delivery_phone : null,
    };

    const sanitizedAssignment = assignment
      ? {
          status: assignment.status,
          priority: assignment.priority,
          assigned_at: assignment.assigned_at,
          accepted_at: assignment.accepted_at,
          arrived_at_store_at: assignment.arrived_at_store_at,
          picked_up_at: assignment.picked_up_at,
          arrived_at_customer_at: assignment.arrived_at_customer_at,
          delivered_at: assignment.delivered_at,
          failure_reason: assignment.failure_reason,
          vehicle_type: assignment.vehicle_type,
          vehicle_number: assignment.vehicle_number,
          partner_first_name: firstName,
          partner_name: firstName || 'Partner',
          partner_phone: canSeeOtpAndContact && !isCompletedOrCancelled ? assignment.partner_phone : null,
        }
      : null;

    return {
      order: sanitizedOrder,
      items,
      history,
      assignment: sanitizedAssignment,
      store: {
        name: store.name,
        addressLine1: store.addressLine1,
        city: store.city,
        latitude: store.latitude,
        longitude: store.longitude,
        phone: store.phone,
        googleMapsUrl: store.googleMapsUrl,
      },
      tracking: {
        driverLat: rawDriverLat,
        driverLng: rawDriverLng,
        destLat,
        destLng,
        distanceKm,
        etaMinutes,
        etaUnavailableReason,
        encodedPolyline,
        lastLocationAt,
        isLocationStale,
        freshnessThresholdSec,
        locationRevoked: isCompletedOrCancelled,
        directionsUrl:
          !isCompletedOrCancelled && rawDriverLat !== null && rawDriverLng !== null
            ? mapsAdapter.getDirectionsUrl(rawDriverLat, rawDriverLng, destLat, destLng)
            : null,
      },
      serverTimestamp: new Date().toISOString(),
    };
  }

  router.get('/track/:orderId', async (req: AuthenticatedRequest, res) => {
    const payload = await buildTrackPayload(req.params.orderId, req);
    if (!payload) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json(payload);
  });

  router.get('/track/:orderId/poll', async (req: AuthenticatedRequest, res) => {
    const payload = await buildTrackPayload(req.params.orderId, req);
    if (!payload) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    res.json(payload);
  });

  // Account Dashboard Aggregated Data
  router.get('/account/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
    const store = getPublicStoreInfo();
    const userId = req.auth!.userId;

    const orders = sqlite
      .prepare(
        `SELECT o.*, a.label as address_label, a.line1 as address_line1, a.city as address_city, i.invoice_number
         FROM orders o
         LEFT JOIN addresses a ON a.id = o.address_id
         LEFT JOIN invoices i ON i.order_id = o.id
         WHERE o.user_id = ?
         ORDER BY o.created_at DESC`
      )
      .all(userId) as Array<Record<string, unknown>>;

    const items = sqlite
      .prepare('SELECT * FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)')
      .all(userId) as Array<Record<string, unknown>>;

    const addresses = sqlite
      .prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC')
      .all(userId);

    const prescriptions = (sqlite
      .prepare(
        `SELECT p.*, (SELECT remarks FROM prescription_reviews WHERE prescription_id = p.id ORDER BY created_at DESC LIMIT 1) as latest_remarks
         FROM prescriptions p
         WHERE p.user_id = ?
         ORDER BY p.created_at DESC`
      )
      .all(userId) as Array<Record<string, unknown>>).map((rx) => {
      const fUrl = String(rx.file_url || '');
      const signedUrl = fUrl.startsWith('/uploads/prescriptions/')
        ? createSignedFileUrl('prescriptions', fUrl.replace('/uploads/prescriptions/', ''))
        : fUrl;
      return { ...rx, signed_file_url: signedUrl };
    });

    const savedRows = sqlite
      .prepare(
        `${BASE_MEDICINE_SELECT}
         JOIN saved_items si ON si.medicine_id = m.id
         WHERE si.user_id = ? AND si.list_type = 'WISHLIST' AND m.is_active = 1 AND m.is_pharmacist_approved = 1
         ORDER BY si.created_at DESC`
      )
      .all(store.id, store.id, userId) as Array<Record<string, unknown>>;

    const invoices = sqlite
      .prepare(
        `SELECT i.*, o.order_number, o.status as order_status, o.payment_status
         FROM invoices i
         JOIN orders o ON o.id = i.order_id
         WHERE o.user_id = ?
         ORDER BY i.issued_at DESC`
      )
      .all(userId);

    const refundRequests = sqlite
      .prepare(
        `SELECT rr.*, o.order_number
         FROM refund_requests rr
         JOIN orders o ON o.id = rr.order_id
         WHERE rr.user_id = ?
         ORDER BY rr.created_at DESC`
      )
      .all(userId);

    const supportTickets = sqlite
      .prepare('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId);

    const notifications = sqlite
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 25')
      .all(userId);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      profile: getUserDTOById(userId),
      notificationPreferences: getUserNotificationPreferences(userId),
      addresses,
      orders: orders.map((o) => ({
        ...o,
        items: items.filter((it) => it.order_id === o.id),
      })),
      prescriptions,
      savedProducts: savedRows.map((r) => buildMedicineDTO(r)),
      invoices,
      refundRequests,
      supportTickets,
      notifications,
    });
  });

  router.get('/account/notification-preferences', requireAuth, (req: AuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ preferences: getUserNotificationPreferences(req.auth!.userId) });
  });

  router.patch('/account/notification-preferences', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        inApp: z.boolean().optional(),
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
        marketingConsent: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid notification preferences' });
      return;
    }
    const updated = updateUserNotificationPreferences(req.auth!.userId, parsed.data);
    res.json({ preferences: updated });
  });

  router.post('/notifications/mark-read', requireAuth, (req: AuthenticatedRequest, res) => {
    sqlite.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.auth!.userId);
    res.json({ ok: true });
  });

  router.post('/refund-requests', requireAuth, (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        orderId: z.string().min(1),
        reason: z.string().trim().min(5).max(400),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Order and valid refund reason required' });
      return;
    }
    const order = sqlite
      .prepare('SELECT id, total_paise, order_number FROM orders WHERE id = ? AND user_id = ?')
      .get(parsed.data.orderId, req.auth!.userId) as { id: string; total_paise: number; order_number: string } | undefined;
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const id = crypto.randomUUID();
    sqlite
      .prepare(
        'INSERT INTO refund_requests (id, order_id, user_id, reason, amount_paise, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(id, order.id, req.auth!.userId, parsed.data.reason, order.total_paise, 'SUBMITTED', new Date().toISOString());
    res.status(201).json({ ok: true, id });
  });

  router.get('/invoices/:orderId', requireAuth, (req: AuthenticatedRequest, res) => {
    const store = getPublicStoreInfo();
    const order = sqlite
      .prepare(
        `SELECT o.*, i.invoice_number, i.issued_at, a.recipient_name, a.line1, a.city, a.state, a.postal_code, u.full_name, u.phone
         FROM orders o
         JOIN invoices i ON i.order_id = o.id
         JOIN users u ON u.id = o.user_id
         LEFT JOIN addresses a ON a.id = o.address_id
         WHERE (o.id = ? OR o.order_number = ?) AND o.user_id = ?`
      )
      .get(req.params.orderId, req.params.orderId, req.auth!.userId) as Record<string, unknown> | undefined;

    if (!order) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const items = sqlite.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id as string);
    res.json({ store, order, items });
  });

  // Prescription Endpoints
  router.get('/prescriptions/demo-sample-svg', (_req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(`
      <svg xmlns="http://www.w3.org/2000/svg" width="520" height="340" viewBox="0 0 520 340">
        <rect width="520" height="340" fill="#FFFFFF" stroke="#E1E5EB" stroke-width="2"/>
        <rect x="0" y="0" width="520" height="52" fill="#D71920"/>
        <text x="24" y="32" fill="#FFFFFF" font-family="sans-serif" font-size="16" font-weight="700">SAMPLE DEMONSTRATION PRESCRIPTION (NOT REAL)</text>
        <text x="24" y="88" fill="#202630" font-family="sans-serif" font-size="14" font-weight="700">Dr. R. K. Kulkarni, MD (Demo Clinic)</text>
        <text x="24" y="110" fill="#526071" font-family="sans-serif" font-size="12">Patient: Ananya Deshmukh · Mira Road East</text>
        <line x1="24" y1="128" x2="496" y2="128" stroke="#E1E5EB"/>
        <text x="24" y="160" fill="#202630" font-family="monospace" font-size="14">Rx 1. Metformin SR 500mg — 1 tab OD after dinner</text>
        <text x="24" y="190" fill="#202630" font-family="monospace" font-size="14">Rx 2. Telmisartan 40mg — 1 tab OD morning</text>
        <text x="24" y="295" fill="#16835D" font-family="sans-serif" font-size="12">Demonstration document for pharmacist review workflow testing</text>
      </svg>
    `);
  });

  router.get('/prescriptions', requireAuth, (req: AuthenticatedRequest, res) => {
    const rows = (sqlite
      .prepare(
        `SELECT p.*, (SELECT remarks FROM prescription_reviews WHERE prescription_id = p.id ORDER BY created_at DESC LIMIT 1) as latest_remarks
         FROM prescriptions p
         WHERE p.user_id = ?
         ORDER BY p.created_at DESC`
      )
      .all(req.auth!.userId) as Array<Record<string, unknown>>).map((rx) => {
      const fUrl = String(rx.file_url || '');
      const signedUrl = fUrl.startsWith('/uploads/prescriptions/')
        ? createSignedFileUrl('prescriptions', fUrl.replace('/uploads/prescriptions/', ''))
        : fUrl;
      return { ...rx, signed_file_url: signedUrl };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ prescriptions: rows });
  });

  router.post('/prescriptions', requireAuth, upload.single('file'), async (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        patientName: z.string().trim().min(2).max(100),
        doctorName: z.string().trim().max(100).optional(),
        contactPhone: z.string().trim().max(20).optional(),
        contactEmail: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(500).optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Patient name is required' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Prescription file (JPG, PNG, or PDF) is required' });
      return;
    }

    const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedMime.includes(req.file.mimetype)) {
      res.status(400).json({ error: 'Only JPG, PNG, WEBP, or PDF files are accepted' });
      return;
    }

    const scanResult = await malwareScannerService.scanBuffer({
      buffer: req.file.buffer,
      declaredMime: req.file.mimetype,
      originalName: req.file.originalname,
    });
    if (!scanResult.clean) {
      res.status(400).json({ error: scanResult.reason || 'Uploaded document failed security & file signature check' });
      return;
    }

    const saved = await storageService.saveFile({
      folder: 'prescriptions',
      originalName: req.file.originalname,
      mimeType: scanResult.detectedMime || req.file.mimetype,
      buffer: req.file.buffer,
    });

    const store = getPublicStoreInfo();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    sqlite
      .prepare(
        `INSERT INTO prescriptions (
          id, store_id, user_id, file_url, file_mime_type, patient_name, doctor_name,
          contact_phone, contact_email, notes, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        store.id,
        req.auth!.userId,
        saved.publicUrl,
        scanResult.detectedMime || req.file.mimetype,
        sanitizeTextInput(parsed.data.patientName),
        parsed.data.doctorName ? sanitizeTextInput(parsed.data.doctorName) : null,
        parsed.data.contactPhone || null,
        parsed.data.contactEmail || null,
        parsed.data.notes ? sanitizeTextInput(parsed.data.notes) : null,
        PrescriptionStatus.PENDING_REVIEW,
        now,
        now
      );

    realtimeService.emitPrescriptionReview(store.id, req.auth!.userId, {
      prescriptionId: id,
      status: PrescriptionStatus.PENDING_REVIEW,
    });

    const rx = sqlite.prepare('SELECT * FROM prescriptions WHERE id = ?').get(id) as Record<string, unknown>;
    const signedUrl = createSignedFileUrl('prescriptions', saved.publicUrl.replace('/uploads/prescriptions/', ''));
    res.status(201).json({ prescription: { ...rx, signed_file_url: signedUrl } });
  });

  router.post('/prescriptions/:id/accept-quotation', requireAuth, (req: AuthenticatedRequest, res) => {
    const rx = sqlite
      .prepare('SELECT * FROM prescriptions WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.auth!.userId) as Record<string, unknown> | undefined;
    if (!rx) {
      res.status(404).json({ error: 'Prescription not found' });
      return;
    }
    if (!rx.quoted_amount_paise) {
      res.status(400).json({ error: 'No quotation has been prepared for this prescription yet' });
      return;
    }
    const quotedTotal = Number(rx.quoted_amount_paise);
    const now = new Date().toISOString();
    databaseService.withTransaction(() => {
      sqlite
        .prepare('UPDATE prescriptions SET quotation_accepted = 1, updated_at = ? WHERE id = ?')
        .run(now, rx.id as string);

      if (rx.order_id) {
        const order = sqlite
          .prepare('SELECT id, store_id, status, payment_method, payment_status FROM orders WHERE id = ?')
          .get(String(rx.order_id)) as
          | { id: string; store_id: string; status: string; payment_method: string; payment_status: string }
          | undefined;

        if (order) {
          sqlite
            .prepare(
              `UPDATE orders
               SET total_paise = ?, quoted_total_paise = ?, quotation_status = 'ACCEPTED', quotation_accepted = 1, updated_at = ?
               WHERE id = ?`
            )
            .run(quotedTotal, quotedTotal, now, order.id);

          sqlite
            .prepare('UPDATE invoices SET total_paise = ? WHERE order_id = ?')
            .run(quotedTotal, order.id);

          sqlite
            .prepare("UPDATE payments SET amount_paise = ?, updated_at = ? WHERE order_id = ? AND status != 'PAID'")
            .run(quotedTotal, now, order.id);

          if (order.status === OrderStatus.AWAITING_CUSTOMER_ACCEPTANCE || order.status === OrderStatus.APPROVED) {
            const nextStatus =
              order.payment_method !== PaymentMethod.CASH_ON_DELIVERY && order.payment_status !== PaymentStatus.PAID
                ? OrderStatus.PAYMENT_PENDING
                : OrderStatus.CONFIRMED;

            orderLifecycleService.transition({
              orderId: order.id,
              storeId: order.store_id,
              nextStatus,
              actorUserId: req.auth!.userId,
              note: `Customer accepted pharmacist quotation of ₹${(quotedTotal / 100).toFixed(2)}`,
            });
          }
        }
      }
    });
    res.json({ ok: true, quotedTotalPaise: quotedTotal });
  });

  // Contact / Support Tickets
  router.post('/contact', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(100),
        phone: z.string().trim().min(10).max(16),
        email: z.string().trim().email().optional().or(z.literal('')),
        subject: z.string().trim().min(3).max(140),
        message: z.string().trim().min(5).max(1000),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Please complete all required inquiry fields' });
      return;
    }

    const store = getPublicStoreInfo();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO support_tickets (id, store_id, user_id, name, phone, email, subject, message, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        store.id,
        req.auth?.userId || null,
        parsed.data.name,
        parsed.data.phone,
        parsed.data.email || null,
        parsed.data.subject,
        parsed.data.message,
        'OPEN',
        now,
        now
      );

    res.status(201).json({ ok: true, ticketId: id });
  });

  return router;
}
