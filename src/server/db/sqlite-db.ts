import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import type { IDatabaseService } from '../interfaces/services.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'shree_leela_pharmacy.db');

export const sqlite = new DatabaseSync(DB_PATH);
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

export const databaseService: IDatabaseService = {
  withTransaction<T>(fn: () => T): T {
    sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      sqlite.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        sqlite.exec('ROLLBACK;');
      } catch {
        // Ignore rollback failure
      }
      throw error;
    }
  },
};

function ensureColumn(table: string, column: string, definition: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function getDbPath(): string {
  return DB_PATH;
}

export function backupDatabase(targetDir?: string): { path: string; sizeBytes: number; createdAt: string } {
  const backupDir = targetDir ? path.resolve(targetDir) : path.resolve(process.cwd(), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destPath = path.join(backupDir, `shree_leela_pharmacy_${stamp}.db`);
  try {
    // Escaped single quotes for SQLite VACUUM INTO path
    const safePath = destPath.replace(/'/g, "''");
    sqlite.exec(`VACUUM INTO '${safePath}'`);
  } catch {
    sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    fs.copyFileSync(DB_PATH, destPath);
  }
  const stat = fs.statSync(destPath);
  return {
    path: destPath,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
  };
}

export function initSchemaAndSeed(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      legal_name TEXT,
      gstin TEXT,
      currency TEXT NOT NULL DEFAULT 'INR',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address_line1 TEXT NOT NULL,
      landmark TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'India',
      phone TEXT NOT NULL,
      email TEXT,
      operating_hours TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      google_maps_url TEXT,
      drug_license_number TEXT,
      logo_placeholder INTEGER NOT NULL DEFAULT 1,
      logo_url TEXT,
      storefront_photo_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      phone TEXT UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_email_verified INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      store_id TEXT REFERENCES stores(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      assigned_by TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, store_id, role)
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      remember_me INTEGER NOT NULL DEFAULT 0,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      date_of_birth TEXT,
      allergies_note TEXT,
      chronic_conditions TEXT,
      preferred_language TEXT NOT NULL DEFAULT 'en',
      loyalty_points INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employee_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      employee_code TEXT NOT NULL UNIQUE,
      designation TEXT NOT NULL,
      pharmacist_reg_number TEXT,
      joined_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS delivery_partners (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      vehicle_type TEXT NOT NULL,
      vehicle_number TEXT NOT NULL,
      license_number TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      is_on_shift INTEGER NOT NULL DEFAULT 1,
      current_lat REAL,
      current_lng REAL,
      last_location_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      line1 TEXT NOT NULL,
      line2 TEXT,
      landmark TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subcategories (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS manufacturers (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'India',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, name)
    );

    CREATE TABLE IF NOT EXISTS medicines (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id),
      subcategory_id TEXT REFERENCES subcategories(id),
      manufacturer_id TEXT NOT NULL REFERENCES manufacturers(id),
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      generic_name TEXT NOT NULL,
      composition TEXT NOT NULL,
      dosage_form TEXT NOT NULL,
      pack_size TEXT NOT NULL,
      schedule_type TEXT NOT NULL DEFAULT 'OTC',
      requires_prescription INTEGER NOT NULL DEFAULT 0,
      mrp_paise INTEGER NOT NULL,
      sale_price_paise INTEGER NOT NULL,
      gst_percent INTEGER NOT NULL DEFAULT 12,
      hsn_code TEXT,
      storage_instructions TEXT,
      usage_summary TEXT,
      side_effects_summary TEXT,
      safety_advice TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_demo_data INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medicine_images (
      id TEXT PRIMARY KEY,
      medicine_id TEXT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      alt_text TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      contact_name TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      gstin TEXT,
      drug_license TEXT,
      address TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medicine_batches (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      medicine_id TEXT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
      supplier_id TEXT REFERENCES suppliers(id),
      batch_number TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      quantity_received INTEGER NOT NULL,
      quantity_available INTEGER NOT NULL,
      purchase_price_paise INTEGER NOT NULL,
      mrp_paise INTEGER NOT NULL,
      is_demo_data INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(store_id, medicine_id, batch_number)
    );

    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL REFERENCES medicine_batches(id) ON DELETE CASCADE,
      txn_type TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      notes TEXT,
      performed_by_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carts (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      guest_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      medicine_id TEXT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(cart_id, medicine_id)
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      discount_type TEXT NOT NULL,
      discount_value INTEGER NOT NULL,
      min_order_paise INTEGER NOT NULL DEFAULT 0,
      max_discount_paise INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      address_id TEXT REFERENCES addresses(id),
      coupon_id TEXT REFERENCES coupons(id),
      order_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      prescription_status TEXT NOT NULL,
      subtotal_paise INTEGER NOT NULL,
      discount_paise INTEGER NOT NULL DEFAULT 0,
      delivery_fee_paise INTEGER NOT NULL DEFAULT 0,
      tax_paise INTEGER NOT NULL DEFAULT 0,
      total_paise INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      delivery_notes TEXT,
      delivery_otp TEXT,
      is_demo_data INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      medicine_id TEXT NOT NULL REFERENCES medicines(id),
      batch_id TEXT REFERENCES medicine_batches(id),
      medicine_name TEXT NOT NULL,
      pack_size TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_paise INTEGER NOT NULL,
      mrp_paise INTEGER NOT NULL,
      tax_paise INTEGER NOT NULL,
      line_total_paise INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      note TEXT,
      changed_by_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      order_id TEXT REFERENCES orders(id),
      file_url TEXT NOT NULL,
      file_mime_type TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      doctor_name TEXT,
      notes TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prescription_reviews (
      id TEXT PRIMARY KEY,
      prescription_id TEXT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
      pharmacist_id TEXT NOT NULL REFERENCES users(id),
      decision TEXT NOT NULL,
      remarks TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS delivery_assignments (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id),
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      delivery_partner_id TEXT NOT NULL REFERENCES delivery_partners(id),
      status TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      picked_up_at TEXT,
      delivered_at TEXT,
      proof_note TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS driver_locations (
      id TEXT PRIMARY KEY,
      delivery_partner_id TEXT NOT NULL REFERENCES delivery_partners(id) ON DELETE CASCADE,
      order_id TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      heading REAL,
      speed_kmh REAL,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      amount_paise INTEGER NOT NULL,
      provider_reference TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      amount_paise INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROCESSED',
      processed_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL UNIQUE,
      subtotal_paise INTEGER NOT NULL,
      tax_paise INTEGER NOT NULL,
      discount_paise INTEGER NOT NULL,
      total_paise INTEGER NOT NULL,
      issued_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id),
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      store_id TEXT REFERENCES stores(id),
      actor_user_id TEXT REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metadata_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(store_id, key)
    );

    CREATE TABLE IF NOT EXISTS saved_items (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      guest_key TEXT,
      medicine_id TEXT NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
      list_type TEXT NOT NULL DEFAULT 'WISHLIST',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS availability_requests (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      medicine_id TEXT REFERENCES medicines(id),
      medicine_name TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      requester_phone TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_promotions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      cta_label TEXT NOT NULL,
      cta_link TEXT NOT NULL,
      badge_text TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_demo_data INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS serviceable_pincodes (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      pincode TEXT NOT NULL,
      area_name TEXT NOT NULL,
      delivery_fee_paise INTEGER NOT NULL DEFAULT 2500,
      estimated_mins INTEGER NOT NULL DEFAULT 45,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(store_id, pincode)
    );

    CREATE TABLE IF NOT EXISTS refund_requests (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      amount_paise INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'SUBMITTED',
      admin_note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS legal_policies (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(store_id, slug)
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      po_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ORDERED',
      expected_date TEXT,
      subtotal_paise INTEGER NOT NULL DEFAULT 0,
      paid_paise INTEGER NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'UNPAID',
      invoice_url TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      medicine_id TEXT NOT NULL REFERENCES medicines(id),
      quantity_ordered INTEGER NOT NULL,
      quantity_received INTEGER NOT NULL DEFAULT 0,
      unit_cost_paise INTEGER NOT NULL,
      batch_number TEXT,
      mfg_date TEXT,
      expiry_date TEXT,
      mrp_paise INTEGER
    );

    CREATE TABLE IF NOT EXISTS supplier_payments (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      amount_paise INTEGER NOT NULL,
      method TEXT NOT NULL,
      reference TEXT,
      paid_by TEXT,
      paid_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bulk_import_jobs (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      uploaded_by TEXT REFERENCES users(id),
      file_name TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      inserted_rows INTEGER NOT NULL,
      failed_rows INTEGER NOT NULL,
      errors_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prescription_item_reviews (
      id TEXT PRIMARY KEY,
      prescription_id TEXT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
      medicine_id TEXT REFERENCES medicines(id),
      medicine_name TEXT NOT NULL,
      requested_qty INTEGER NOT NULL DEFAULT 1,
      approved_qty INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'APPROVED',
      pharmacist_note TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Safe incremental schema upgrades for Prompt 2 columns
  ensureColumn('medicines', 'brand', 'TEXT');
  ensureColumn('medicines', 'strength', 'TEXT');
  ensureColumn('medicines', 'barcode', 'TEXT');
  ensureColumn('medicines', 'is_featured', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('medicines', 'is_essential', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('medicines', 'is_pharmacist_approved', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('medicines', 'is_recalled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('medicines', 'online_sale_restricted', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('medicines', 'publication_status', "TEXT NOT NULL DEFAULT 'PUBLISHED'");

  ensureColumn('medicine_batches', 'mfg_date', 'TEXT');
  ensureColumn('medicine_batches', 'quantity_reserved', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('medicine_batches', 'quantity_damaged', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('medicine_batches', 'quantity_expired', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('medicine_batches', 'storage_conditions', 'TEXT');
  ensureColumn('medicine_batches', 'is_quarantined', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('medicine_batches', 'quarantine_reason', 'TEXT');

  ensureColumn('categories', 'icon_name', 'TEXT');
  ensureColumn('categories', 'banner_url', 'TEXT');
  ensureColumn('categories', 'seo_description', 'TEXT');
  ensureColumn('categories', 'is_featured', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('delivery_partners', 'photo_url', 'TEXT');
  ensureColumn('delivery_partners', 'account_status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
  ensureColumn('delivery_partners', 'location_accuracy_m', 'REAL');
  ensureColumn('delivery_partners', 'national_id_masked', 'TEXT');

  ensureColumn('driver_locations', 'accuracy_m', 'REAL');
  ensureColumn('store_promotions', 'image_url', 'TEXT');

  ensureColumn('addresses', 'flat_building', 'TEXT');
  ensureColumn('addresses', 'society_name', 'TEXT');
  ensureColumn('addresses', 'street', 'TEXT');

  ensureColumn('orders', 'fulfillment_type', "TEXT NOT NULL DEFAULT 'DELIVERY'");
  ensureColumn('orders', 'quotation_amount_paise', 'INTEGER');
  ensureColumn('orders', 'quotation_notes', 'TEXT');
  ensureColumn('orders', 'quotation_accepted', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'internal_notes', 'TEXT');
  ensureColumn('orders', 'cancellation_reason', 'TEXT');
  ensureColumn('orders', 'cod_reconciled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'cod_reconciled_at', 'TEXT');
  ensureColumn('orders', 'cod_reconciled_by', 'TEXT');

  ensureColumn('prescriptions', 'contact_phone', 'TEXT');
  ensureColumn('prescriptions', 'contact_email', 'TEXT');
  ensureColumn('prescriptions', 'quoted_amount_paise', 'INTEGER');
  ensureColumn('prescriptions', 'pharmacist_quotation_notes', 'TEXT');
  ensureColumn('prescriptions', 'quotation_accepted', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('orders', 'delivery_otp_expires_at', 'TEXT');
  ensureColumn('orders', 'delivery_otp_attempts', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'delivery_otp_locked_until', 'TEXT');

  ensureColumn('delivery_assignments', 'priority', "TEXT NOT NULL DEFAULT 'NORMAL'");
  ensureColumn('delivery_assignments', 'rejection_reason', 'TEXT');
  ensureColumn('delivery_assignments', 'failure_reason', 'TEXT');
  ensureColumn('delivery_assignments', 'accepted_at', 'TEXT');
  ensureColumn('delivery_assignments', 'arrived_at_store_at', 'TEXT');
  ensureColumn('delivery_assignments', 'arrived_at_customer_at', 'TEXT');
  ensureColumn('delivery_assignments', 'returned_at', 'TEXT');
  ensureColumn('delivery_assignments', 'signature_data_url', 'TEXT');
  ensureColumn('delivery_assignments', 'pod_photo_url', 'TEXT');
  ensureColumn('delivery_assignments', 'cash_collected_paise', 'INTEGER');
  ensureColumn('delivery_assignments', 'estimated_distance_km', 'REAL');
  ensureColumn('delivery_assignments', 'pickup_time_target', 'TEXT');
  ensureColumn('delivery_assignments', 'last_event_seq', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn('driver_locations', 'device_timestamp', 'TEXT');
  ensureColumn('driver_locations', 'is_suspicious', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('driver_locations', 'suspicious_reason', 'TEXT');
  ensureColumn('driver_locations', 'tracking_status', 'TEXT');

  ensureColumn('users', 'marketing_consent', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'notification_prefs_json', 'TEXT');
  ensureColumn('stores', 'pharmacist_name', 'TEXT');
  ensureColumn('stores', 'pharmacist_reg_number', 'TEXT');
  ensureColumn('orders', 'quoted_total_paise', 'INTEGER');
  ensureColumn('orders', 'quotation_status', 'TEXT');
  ensureColumn('orders', 'production_mode', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('payments', 'gateway_order_id', 'TEXT');
  ensureColumn('payments', 'gateway_payment_id', 'TEXT');
  ensureColumn('payments', 'signature_verified', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('payments', 'webhook_event_id', 'TEXT');
  ensureColumn('payments', 'failure_reason', 'TEXT');
  ensureColumn('payments', 'idempotency_key', 'TEXT');
  ensureColumn('prescriptions', 'clarification_notes', 'TEXT');
  ensureColumn('refunds', 'gateway_refund_id', 'TEXT');
  ensureColumn('refunds', 'idempotency_key', 'TEXT');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS delivery_offline_events (
      idempotency_key TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      response_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      channel TEXT NOT NULL,
      template_key TEXT NOT NULL,
      recipient TEXT,
      subject TEXT NOT NULL,
      body_preview TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_response TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_webhook_events (
      event_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'RAZORPAY',
      event_type TEXT NOT NULL,
      payment_id TEXT,
      gateway_order_id TEXT,
      signature_verified INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_onboarding_state (
      store_id TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
      current_step INTEGER NOT NULL DEFAULT 1,
      steps_completed_json TEXT NOT NULL DEFAULT '{}',
      compliance_signed_off INTEGER NOT NULL DEFAULT 0,
      signed_off_by TEXT,
      signed_off_at TEXT,
      production_sales_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    -- Production performance & query indexes
    CREATE INDEX IF NOT EXISTS idx_driver_locations_recorded_at ON driver_locations(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_driver_locations_partner_time ON driver_locations(delivery_partner_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_medicines_search ON medicines(business_id, is_active, is_pharmacist_approved, name, generic_name);
    CREATE INDEX IF NOT EXISTS idx_medicines_barcode ON medicines(barcode);
    CREATE INDEX IF NOT EXISTS idx_orders_store_status_date ON orders(store_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_user_date ON orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_delivery_assignments_partner_status ON delivery_assignments(delivery_partner_id, status);
    CREATE INDEX IF NOT EXISTS idx_batches_store_med_expiry ON medicine_batches(store_id, medicine_id, expiry_date);
    CREATE INDEX IF NOT EXISTS idx_payments_order_status ON payments(order_id, status);
    CREATE INDEX IF NOT EXISTS idx_payments_gateway_order ON payments(gateway_order_id);
    CREATE INDEX IF NOT EXISTS idx_prescriptions_store_status ON prescriptions(store_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_store_date ON audit_logs(business_id, store_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_logs_user ON notification_logs(user_id, created_at DESC);
  `);

  // Idempotent migration of legacy OrderStatus names to authoritative lifecycle names
  sqlite.exec(`
    UPDATE orders SET status = 'ORDER_RECEIVED' WHERE status = 'PENDING_CONFIRMATION';
    UPDATE orders SET status = 'PRESCRIPTION_PENDING' WHERE status = 'PENDING_PRESCRIPTION';
    UPDATE orders SET status = 'PREPARING' WHERE status = 'PACKING';
    UPDATE order_status_history SET status = 'ORDER_RECEIVED' WHERE status = 'PENDING_CONFIRMATION';
    UPDATE order_status_history SET status = 'PRESCRIPTION_PENDING' WHERE status = 'PENDING_PRESCRIPTION';
    UPDATE order_status_history SET status = 'PREPARING' WHERE status = 'PACKING';
  `);

  const existingBusiness = sqlite.prepare('SELECT id FROM businesses LIMIT 1').get();
  if (!existingBusiness) {
    seedInitialData();
  }

  ensurePrompt2SeedData();
  ensurePrompt3SeedData();
  ensurePrompt5SeedData();
}

function seedInitialData(): void {
  const now = new Date().toISOString();
  const businessId = '11111111-1111-4111-8111-111111111111';
  const storeId = '22222222-2222-4222-8222-222222222222';

  databaseService.withTransaction(() => {
    sqlite
      .prepare(
        `INSERT INTO businesses (id, name, legal_name, gstin, currency, timezone, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        businessId,
        'Shree Leela Medical & General Stores',
        'Shree Leela Medical & General Stores',
        '27AABCS0000A1Z5 (Demo Placeholder)',
        'INR',
        'Asia/Kolkata',
        1,
        now,
        now
      );

    sqlite
      .prepare(
        `INSERT INTO stores (
          id, business_id, code, name, address_line1, landmark, city, state, postal_code, country,
          phone, email, operating_hours, latitude, longitude, google_maps_url, drug_license_number,
          logo_placeholder, logo_url, storefront_photo_url, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        storeId,
        businessId,
        'SLM-MIRA-01',
        'Shree Leela Medical & General Stores',
        'Gaurav Avenue, Hatkesh Road',
        'Near GCC Club',
        'Mira Road East',
        'Maharashtra',
        '401107',
        'India',
        '+91 72082 82337',
        'care@shreeleelamedical.example',
        '8 AM to 11 PM',
        19.2813,
        72.8782,
        'https://maps.app.goo.gl/t2GPkm2kVdTe4Cw46',
        'MH-THN-DL-DEMO-001 (Replace in Admin Settings)',
        1,
        null,
        null,
        1,
        now,
        now
      );

    const settings: Array<[string, string]> = [
      ['demoMode', 'true'],
      ['deliveryFeePaise', '2500'],
      ['freeDeliveryThresholdPaise', '49900'],
      ['deliveryRadiusKm', '6'],
      ['acceptOnlinePayments', 'true'],
      ['acceptCashOnDelivery', 'true'],
    ];
    for (const [k, v] of settings) {
      sqlite
        .prepare('INSERT INTO store_settings (id, store_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), storeId, k, v, now);
    }

    const users = [
      {
        id: '33333333-3333-4333-8333-333333333301',
        email: 'admin.demo@shreeleela.example',
        phone: '+919820000001',
        fullName: 'Rajesh Sharma (Store Admin)',
        pass: 'AdminPass@123',
        role: 'STORE_ADMIN',
        empCode: 'EMP-001',
        designation: 'Store Administrator',
        regNo: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333302',
        email: 'pharmacist.demo@shreeleela.example',
        phone: '+919820000002',
        fullName: 'Dr. Kavita Joshi (Pharmacist)',
        pass: 'PharmaPass@123',
        role: 'PHARMACIST',
        empCode: 'EMP-002',
        designation: 'Registered Pharmacist',
        regNo: 'MH-PHARM-DEMO-4812',
      },
      {
        id: '33333333-3333-4333-8333-333333333303',
        email: 'inventory.demo@shreeleela.example',
        phone: '+919820000003',
        fullName: 'Suresh Nair (Inventory Lead)',
        pass: 'InvPass@123',
        role: 'INVENTORY_MANAGER',
        empCode: 'EMP-003',
        designation: 'Inventory Manager',
        regNo: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333304',
        email: 'delivery.demo@shreeleela.example',
        phone: '+919820000004',
        fullName: 'Vikram Yadav (Delivery Partner)',
        pass: 'RiderPass@123',
        role: 'DELIVERY_PARTNER',
        empCode: null,
        designation: null,
        regNo: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333305',
        email: 'customer.demo@shreeleela.example',
        phone: '+919820000005',
        fullName: 'Ananya Deshmukh (Demo Customer)',
        pass: 'DemoPass@123',
        role: 'CUSTOMER',
        empCode: null,
        designation: null,
        regNo: null,
      },
      {
        id: '33333333-3333-4333-8333-333333333306',
        email: 'superadmin.demo@shreeleela.example',
        phone: '+919820000006',
        fullName: 'Owner Account (Super Admin)',
        pass: 'SuperPass@123',
        role: 'SUPER_ADMIN',
        empCode: 'EMP-000',
        designation: 'Managing Director',
        regNo: null,
      },
    ];

    for (const u of users) {
      const hash = bcrypt.hashSync(u.pass, 10);
      sqlite
        .prepare(
          `INSERT INTO users (id, business_id, email, phone, full_name, password_hash, is_email_verified, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(u.id, businessId, u.email, u.phone, u.fullName, hash, 1, 1, now, now);

      sqlite
        .prepare('INSERT INTO user_roles (id, user_id, store_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), u.id, storeId, u.role, now);

      if (u.empCode) {
        sqlite
          .prepare(
            `INSERT INTO employee_profiles (id, user_id, store_id, employee_code, designation, pharmacist_reg_number, joined_at, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(crypto.randomUUID(), u.id, storeId, u.empCode, u.designation, u.regNo, now, 1, now, now);
      }
    }

    const customerId = '33333333-3333-4333-8333-333333333305';
    sqlite
      .prepare(
        `INSERT INTO customer_profiles (id, user_id, allergies_note, chronic_conditions, preferred_language, loyalty_points, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), customerId, 'None reported', 'Seasonal allergy', 'en', 120, now, now);

    const customerAddressId = '44444444-4444-4444-8444-444444444401';
    sqlite
      .prepare(
        `INSERT INTO addresses (id, user_id, label, recipient_name, phone, flat_building, society_name, street, line1, line2, landmark, city, state, postal_code, latitude, longitude, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        customerAddressId,
        customerId,
        'Home',
        'Ananya Deshmukh',
        '+919820000005',
        'B-404',
        'Shanti Gardens',
        'Sector 5, Beverly Park',
        'B-404, Shanti Gardens, Sector 5',
        'Beverly Park',
        'Near Cinemax Mira Road',
        'Mira Road East',
        'Maharashtra',
        '401107',
        19.2869,
        72.8716,
        1,
        now,
        now
      );

    const deliveryPartnerId = '55555555-5555-4555-8555-555555555501';
    sqlite
      .prepare(
        `INSERT INTO delivery_partners (id, user_id, store_id, vehicle_type, vehicle_number, license_number, is_available, is_on_shift, current_lat, current_lng, last_location_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        deliveryPartnerId,
        '33333333-3333-4333-8333-333333333304',
        storeId,
        'Electric Two-Wheeler',
        'MH-04-DEMO-4810',
        'MH04-2021-DEMO-991',
        1,
        1,
        19.2835,
        72.8754,
        now,
        now,
        now
      );

    const mfrs = [
      { id: 'mfr-1', name: 'Apex Care Formulations (Demo)' },
      { id: 'mfr-2', name: 'Sahyadri Pharma Labs (Demo)' },
      { id: 'mfr-3', name: 'Western MedTech Devices (Demo)' },
      { id: 'mfr-4', name: 'Konkan Botanicals & Health (Demo)' },
    ];
    for (const m of mfrs) {
      sqlite
        .prepare('INSERT INTO manufacturers (id, business_id, name, country, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(m.id, businessId, m.name, 'India', now, now);
    }

    const supId = 'sup-1';
    sqlite
      .prepare(
        `INSERT INTO suppliers (id, business_id, name, contact_name, phone, email, gstin, drug_license, address, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        supId,
        businessId,
        'Thane Metro Pharma Distributors (Demo)',
        'Mahesh Kulkarni',
        '+919820099900',
        'dispatch@thanedist.example',
        '27AAACT0000B1Z2',
        'MH-THN-WH-DEMO-20B',
        'Wagle Industrial Estate, Thane West',
        now,
        now
      );

    // Coupons
    sqlite
      .prepare(
        `INSERT INTO coupons (id, business_id, code, description, discount_type, discount_value, min_order_paise, max_discount_paise, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), businessId, 'LEELA10', '10% off on demo orders above ₹300 (Max ₹150)', 'PERCENT', 10, 30000, 15000, 1, now);
    sqlite
      .prepare(
        `INSERT INTO coupons (id, business_id, code, description, discount_type, discount_value, min_order_paise, max_discount_paise, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), businessId, 'FIRST50', 'Flat ₹50 off on orders above ₹250', 'FLAT', 5000, 25000, 5000, 1, now);
  });
}

function ensurePrompt2SeedData(): void {
  const now = new Date().toISOString();
  const businessId = '11111111-1111-4111-8111-111111111111';
  const storeId = '22222222-2222-4222-8222-222222222222';
  const supId = 'sup-1';

  // Ensure all 13 Prompt 2 categories + nested subcategories
  const prompt2Categories: Array<{
    id: string;
    name: string;
    slug: string;
    desc: string;
    order: number;
    subs: Array<{ id: string; name: string; slug: string }>;
  }> = [
    {
      id: 'cat-tablets',
      name: 'Tablets and Capsules',
      slug: 'tablets-and-capsules',
      desc: 'Oral solid dosage forms organized by pack type',
      order: 1,
      subs: [
        { id: 'sub-tablets-std', name: 'Oral Tablets', slug: 'oral-tablets' },
        { id: 'sub-capsules-sr', name: 'Sustained Release Capsules', slug: 'sustained-release-capsules' },
      ],
    },
    {
      id: 'cat-syrups',
      name: 'Syrups and Oral Liquids',
      slug: 'syrups-and-oral-liquids',
      desc: 'Liquid oral formulations, suspensions, and syrups',
      order: 2,
      subs: [
        { id: 'sub-syrups-cough', name: 'Cough Syrups', slug: 'cough-syrups' },
        { id: 'sub-syrups-antacid', name: 'Antacid Suspensions', slug: 'antacid-suspensions' },
      ],
    },
    {
      id: 'cat-diabetes',
      name: 'Diabetes Care',
      slug: 'diabetes-care',
      desc: 'Prescription glycemic products and glucose testing supplies',
      order: 3,
      subs: [
        { id: 'sub-diabetes-tabs', name: 'Glycemic Tablets', slug: 'glycemic-tablets' },
        { id: 'sub-diabetes-strips', name: 'Test Strips & Lancets', slug: 'test-strips-lancets' },
      ],
    },
    {
      id: 'cat-heart',
      name: 'Heart and Blood Pressure',
      slug: 'heart-and-blood-pressure',
      desc: 'Prescription cardiovascular maintenance medicines',
      order: 4,
      subs: [
        { id: 'sub-heart-bp', name: 'Blood Pressure Care', slug: 'blood-pressure-care' },
      ],
    },
    {
      id: 'cat-vitamins',
      name: 'Vitamins and Supplements',
      slug: 'vitamins-and-supplements',
      desc: 'Daily nutritional supplements, minerals, and tonics',
      order: 5,
      subs: [
        { id: 'sub-vit-multi', name: 'Multivitamins & Minerals', slug: 'multivitamins-minerals' },
        { id: 'sub-vit-d3', name: 'Vitamin D3 & Calcium', slug: 'vitamin-d3-calcium' },
      ],
    },
    {
      id: 'cat-skin',
      name: 'Skin Care Medicines',
      slug: 'skin-care-medicines',
      desc: 'Topical creams, medicated cleansers, and ointments',
      order: 6,
      subs: [
        { id: 'sub-skin-topical', name: 'Topical Antiseptics & Creams', slug: 'topical-antiseptics-creams' },
      ],
    },
    {
      id: 'cat-eye-ear',
      name: 'Eye and Ear Care',
      slug: 'eye-and-ear-care',
      desc: 'Lubricating eye drops and sterile ear drop solutions',
      order: 7,
      subs: [
        { id: 'sub-eye-drops', name: 'Lubricating Eye Drops', slug: 'lubricating-eye-drops' },
      ],
    },
    {
      id: 'cat-first-aid',
      name: 'First Aid',
      slug: 'first-aid',
      desc: 'Bandages, sterile cotton gauze, and wound care',
      order: 8,
      subs: [
        { id: 'sub-fa-dressings', name: 'Bandages & Sterile Gauze', slug: 'bandages-sterile-gauze' },
      ],
    },
    {
      id: 'cat-pain',
      name: 'Pain Relief',
      slug: 'pain-relief',
      desc: 'Analgesic tablets, topical gels, and sprays',
      order: 9,
      subs: [
        { id: 'sub-pain-oral', name: 'Analgesic Tablets', slug: 'analgesic-tablets' },
        { id: 'sub-pain-topical', name: 'Topical Pain Gels', slug: 'topical-pain-gels' },
      ],
    },
    {
      id: 'cat-digestive',
      name: 'Digestive Health',
      slug: 'digestive-health',
      desc: 'Antacids, ORS hydration, and digestive formulations',
      order: 10,
      subs: [
        { id: 'sub-dig-ppi', name: 'Acidity & Gut Relief', slug: 'acidity-gut-relief' },
      ],
    },
    {
      id: 'cat-respiratory',
      name: 'Respiratory Care',
      slug: 'respiratory-care',
      desc: 'Decongestants, vapor capsules, and respiratory devices',
      order: 11,
      subs: [
        { id: 'sub-resp-allergy', name: 'Cold & Allergy', slug: 'cold-and-allergy' },
      ],
    },
    {
      id: 'cat-devices',
      name: 'Medical Devices',
      slug: 'medical-devices',
      desc: 'Home thermometers, BP monitors, and nebulizers',
      order: 12,
      subs: [
        { id: 'sub-dev-monitors', name: 'BP & Temp Monitors', slug: 'bp-temp-monitors' },
      ],
    },
    {
      id: 'cat-essentials',
      name: 'Pharmacy Essentials',
      slug: 'pharmacy-essentials',
      desc: 'Daily hygiene, sanitizers, masks, and household medical supplies',
      order: 13,
      subs: [
        { id: 'sub-ess-hygiene', name: 'Daily Hygiene & Care', slug: 'daily-hygiene-care' },
      ],
    },
  ];

  // Clear legacy cat-1..cat-8 only if they haven't been replaced yet, or map cleanly
  const resolvedCategoryId = new Map<string, string>();
  const resolvedSubcategoryId = new Map<string, string>();

  for (const c of prompt2Categories) {
    sqlite
      .prepare(
        `INSERT INTO categories (id, business_id, name, slug, description, display_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(slug) DO UPDATE SET name = excluded.name, display_order = excluded.display_order, is_active = 1`
      )
      .run(c.id, businessId, c.name, c.slug, c.desc, c.order, now, now);

    const catRow = sqlite.prepare('SELECT id FROM categories WHERE slug = ?').get(c.slug) as { id: string };
    resolvedCategoryId.set(c.id, catRow.id);

    for (const s of c.subs) {
      sqlite
        .prepare(
          `INSERT INTO subcategories (id, category_id, name, slug, description, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET category_id = excluded.category_id, is_active = 1`
        )
        .run(s.id, catRow.id, s.name, s.slug, c.desc, now, now);

      const subRow = sqlite.prepare('SELECT id FROM subcategories WHERE slug = ?').get(s.slug) as { id: string };
      resolvedSubcategoryId.set(s.id, subRow.id);
    }
  }

  // Ensure Serviceable PIN codes
  const pincodes = [
    { pin: '401107', area: 'Mira Road East (Gaurav Avenue / Hatkesh / Beverly Park)', fee: 2500, mins: 35 },
    { pin: '401105', area: 'Bhayandar East', fee: 3500, mins: 45 },
    { pin: '401101', area: 'Bhayandar West', fee: 3500, mins: 50 },
    { pin: '401106', area: 'Uttan / Gorai Sector', fee: 4500, mins: 60 },
    { pin: '400068', area: 'Dahisar East (Check Naka)', fee: 4000, mins: 50 },
  ];
  for (const p of pincodes) {
    sqlite
      .prepare(
        `INSERT INTO serviceable_pincodes (id, store_id, pincode, area_name, delivery_fee_paise, estimated_mins, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(store_id, pincode) DO NOTHING`
      )
      .run(crypto.randomUUID(), storeId, p.pin, p.area, p.fee, p.mins);
  }

  // Configurable Promotional Banners
  const existingPromo = sqlite.prepare('SELECT id FROM store_promotions LIMIT 1').get();
  if (!existingPromo) {
    const promos = [
      {
        title: 'Upload Your Prescription for Pharmacist Review',
        subtitle: 'Submit a photo or PDF of your doctor prescription. Verified before dispatch at our Hatkesh Road pharmacy.',
        ctaLabel: 'Upload Prescription',
        ctaLink: '/upload-prescription',
        badgeText: 'Rx Verification',
        order: 1,
      },
      {
        title: 'Store Pickup & Mira Road East Neighbourhood Delivery',
        subtitle: 'Open 8 AM to 11 PM daily at Gaurav Avenue, near GCC Club. Check your PIN code serviceability.',
        ctaLabel: 'Browse Pharmacy',
        ctaLink: '/pharmacy',
        badgeText: '8 AM – 11 PM',
        order: 2,
      },
    ];
    for (const pr of promos) {
      sqlite
        .prepare(
          `INSERT INTO store_promotions (id, store_id, title, subtitle, cta_label, cta_link, badge_text, display_order, is_active, is_demo_data, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
        )
        .run(crypto.randomUUID(), storeId, pr.title, pr.subtitle, pr.ctaLabel, pr.ctaLink, pr.badgeText, pr.order, now);
    }
  }

  // Seed or backfill comprehensive demonstration medicines across the 13 categories
  const imgTablets = '/src/assets/images/demo_med_tablets_1795159503038.jpg';
  const imgSyrup = '/src/assets/images/demo_med_syrup_1795159503396.jpg';
  const imgWellness = '/src/assets/images/demo_med_wellness_1795159504101.jpg';
  const imgFirstAid = '/src/assets/images/demo_med_firstaid_1795159504749.jpg';

  const demoMeds = [
      {
        id: 'med-01',
        sku: 'DEMO-PAR-500',
        barcode: '890100000101',
        name: 'Paracetamol 500mg Tablets (Demo)',
        slug: 'paracetamol-500mg-tablets-demo',
        genericName: 'Paracetamol IP 500 mg',
        brand: 'Apex Care',
        strength: '500 mg',
        composition: 'Paracetamol IP 500 mg',
        dosageForm: 'Tablet',
        packSize: 'Strip of 15 Tablets',
        scheduleType: 'OTC',
        rx: 0,
        mrp: 3500,
        sale: 2900,
        gst: 12,
        cat: 'cat-pain',
        sub: 'sub-pain-oral',
        mfr: 'mfr-1',
        imgs: [imgTablets, imgFirstAid],
        stock: 140,
        expiry: '2027-09-30',
        batch: 'DEMO-P500-A1',
        featured: 1,
        essential: 1,
        restricted: 0,
        recalled: 0,
        storage: 'Store below 30°C in a dry place away from direct sunlight.',
        usage: 'Pharmacist-approved demonstration listing for an oral antipyretic and analgesic formulation.',
        sideEffects: 'Rare gastric discomfort when taken on an empty stomach.',
        safety: 'Read pack label carefully. Do not exceed recommended daily limit.',
      },
      {
        id: 'med-02',
        sku: 'DEMO-IBU-400',
        barcode: '890100000102',
        name: 'Ibuprofen + Paracetamol Relief Tabs (Demo)',
        slug: 'ibuprofen-paracetamol-relief-demo',
        genericName: 'Ibuprofen 400mg + Paracetamol 325mg',
        brand: 'Sahyadri Relief',
        strength: '400 mg / 325 mg',
        composition: 'Ibuprofen IP 400 mg + Paracetamol IP 325 mg',
        dosageForm: 'Tablet',
        packSize: 'Strip of 10 Tablets',
        scheduleType: 'Schedule H',
        rx: 1,
        mrp: 6800,
        sale: 5800,
        gst: 12,
        cat: 'cat-tablets',
        sub: 'sub-tablets-std',
        mfr: 'mfr-2',
        imgs: [imgTablets, imgWellness],
        stock: 64,
        expiry: '2027-06-15',
        batch: 'DEMO-IBP-22',
        featured: 1,
        essential: 0,
        restricted: 0,
        recalled: 0,
        storage: 'Keep in cool dry place below 25°C.',
        usage: 'Pharmacist-approved demonstration Schedule H tablet listing.',
        sideEffects: 'Acidity, nausea, mild dizziness.',
        safety: 'Valid physician prescription mandatory before pharmacist approval.',
      },
      {
        id: 'med-03',
        sku: 'DEMO-CET-010',
        barcode: '890100000103',
        name: 'Cetirizine 10mg Tablets (Demo)',
        slug: 'cetirizine-10mg-allergy-demo',
        genericName: 'Cetirizine Hydrochloride 10 mg',
        brand: 'Apex Care',
        strength: '10 mg',
        composition: 'Cetirizine Hydrochloride IP 10 mg',
        dosageForm: 'Tablet',
        packSize: 'Strip of 10 Tablets',
        scheduleType: 'OTC',
        rx: 0,
        mrp: 4200,
        sale: 3400,
        gst: 12,
        cat: 'cat-respiratory',
        sub: 'sub-resp-allergy',
        mfr: 'mfr-1',
        imgs: [imgTablets],
        stock: 95,
        expiry: '2028-01-31',
        batch: 'DEMO-CET-09',
        featured: 1,
        essential: 1,
        restricted: 0,
        recalled: 0,
        storage: 'Store in dry cabinet away from moisture.',
        usage: 'Pharmacist-approved OTC antihistamine listing.',
        sideEffects: 'Mild drowsiness in sensitive individuals.',
        safety: 'Exercise caution while operating machinery if drowsiness occurs.',
      },
      {
        id: 'med-04',
        sku: 'DEMO-COF-100',
        barcode: '890100000104',
        name: 'Ambroxol & Guaifenesin Cough Syrup 100ml (Demo)',
        slug: 'ambroxol-cough-syrup-100ml-demo',
        genericName: 'Ambroxol + Guaifenesin + Terbutaline',
        brand: 'Konkan Care',
        strength: '15mg / 50mg per 5ml',
        composition: 'Ambroxol 15mg + Guaifenesin 50mg / 5ml',
        dosageForm: 'Syrup',
        packSize: 'Bottle of 100 ml',
        scheduleType: 'Schedule H',
        rx: 1,
        mrp: 11800,
        sale: 9900,
        gst: 12,
        cat: 'cat-syrups',
        sub: 'sub-syrups-cough',
        mfr: 'mfr-4',
        imgs: [imgSyrup, imgTablets],
        stock: 42,
        expiry: '2027-04-20',
        batch: 'DEMO-SYR-14',
        featured: 1,
        essential: 0,
        restricted: 0,
        recalled: 0,
        storage: 'Shake well before use. Store upright below 25°C.',
        usage: 'Pharmacist-approved demonstration oral cough syrup listing.',
        sideEffects: 'Mild gastric upset.',
        safety: 'Requires valid prescription verification by registered pharmacist.',
      },
      {
        id: 'med-05',
        sku: 'DEMO-MET-500',
        barcode: '890100000105',
        name: 'Metformin SR 500mg Tablets (Demo)',
        slug: 'metformin-sr-500mg-demo',
        genericName: 'Metformin Hydrochloride Sustained Release 500mg',
        brand: 'Sahyadri Glyco',
        strength: '500 mg SR',
        composition: 'Metformin Hydrochloride IP (SR) 500 mg',
        dosageForm: 'Sustained Release Tablet',
        packSize: 'Strip of 20 Tablets',
        scheduleType: 'Schedule H',
        rx: 1,
        mrp: 9400,
        sale: 7900,
        gst: 12,
        cat: 'cat-diabetes',
        sub: 'sub-diabetes-tabs',
        mfr: 'mfr-2',
        imgs: [imgTablets],
        stock: 110,
        expiry: '2027-11-30',
        batch: 'DEMO-MET-04',
        featured: 1,
        essential: 0,
        restricted: 0,
        recalled: 0,
        storage: 'Store in airtight blister below 30°C.',
        usage: 'Pharmacist-approved Schedule H sustained release tablet listing.',
        sideEffects: 'Mild abdominal bloating.',
        safety: 'Dispensed strictly against valid physician prescription.',
      },
      {
        id: 'med-06',
        sku: 'DEMO-TEL-040',
        barcode: '890100000106',
        name: 'Telmisartan 40mg Tablets (Demo)',
        slug: 'telmisartan-40mg-cardiac-demo',
        genericName: 'Telmisartan IP 40 mg',
        brand: 'Sahyadri Cardio',
        strength: '40 mg',
        composition: 'Telmisartan IP 40 mg',
        dosageForm: 'Tablet',
        packSize: 'Strip of 15 Tablets',
        scheduleType: 'Schedule H',
        rx: 1,
        mrp: 16500,
        sale: 13800,
        gst: 12,
        cat: 'cat-heart',
        sub: 'sub-heart-bp',
        mfr: 'mfr-2',
        imgs: [imgTablets],
        stock: 54,
        expiry: '2027-08-15',
        batch: 'DEMO-TEL-18',
        featured: 0,
        essential: 0,
        restricted: 0,
        recalled: 0,
        storage: 'Keep blister sealed until use.',
        usage: 'Pharmacist-approved Schedule H cardiovascular tablet listing.',
        sideEffects: 'Postural dizziness if dehydrated.',
        safety: 'Valid prescription required.',
      },
      {
        id: 'med-07',
        sku: 'DEMO-PAN-040',
        barcode: '890100000107',
        name: 'Pantoprazole 40mg Gastro Tablets (Demo)',
        slug: 'pantoprazole-40mg-gastro-demo',
        genericName: 'Pantoprazole Sodium Gastro-Resistant 40mg',
        brand: 'Apex Gastro',
        strength: '40 mg',
        composition: 'Pantoprazole IP 40 mg',
        dosageForm: 'Enteric Coated Tablet',
        packSize: 'Strip of 15 Tablets',
        scheduleType: 'Schedule H',
        rx: 1,
        mrp: 12500,
        sale: 9800,
        gst: 12,
        cat: 'cat-digestive',
        sub: 'sub-dig-ppi',
        mfr: 'mfr-1',
        imgs: [imgTablets],
        stock: 80,
        expiry: '2027-12-15',
        batch: 'DEMO-PAN-33',
        featured: 0,
        essential: 0,
        restricted: 0,
        recalled: 0,
        storage: 'Store below 30°C away from moisture.',
        usage: 'Pharmacist-approved gastro-resistant tablet listing.',
        sideEffects: 'Headache or mild nausea.',
        safety: 'Prescription verification required.',
      },
      {
        id: 'med-08',
        sku: 'DEMO-ANT-170',
        barcode: '890100000108',
        name: 'Mint Antacid Oral Suspension 170ml (Demo)',
        slug: 'mint-antacid-suspension-170ml-demo',
        genericName: 'Magaldrate + Simethicone Oral Suspension',
        brand: 'Konkan Care',
        strength: '400mg / 20mg per 5ml',
        composition: 'Magaldrate 400mg + Simethicone 20mg / 5ml',
        dosageForm: 'Oral Suspension',
        packSize: 'Bottle of 170 ml',
        scheduleType: 'OTC',
        rx: 0,
        mrp: 14500,
        sale: 12400,
        gst: 12,
        cat: 'cat-digestive',
        sub: 'sub-dig-ppi',
        mfr: 'mfr-4',
        imgs: [imgSyrup],
        stock: 36,
        expiry: '2027-03-10',
        batch: 'DEMO-ANT-07',
        featured: 1,
        essential: 1,
        restricted: 0,
        recalled: 0,
        storage: 'Do not freeze. Shake well before use.',
        usage: 'Pharmacist-approved OTC oral antacid suspension.',
        sideEffects: 'Mild chalky aftertaste.',
        safety: 'Separate from other oral tablets by 2 hours.',
      },
      {
        id: 'med-09',
        sku: 'DEMO-VIT-060',
        barcode: '890100000109',
        name: 'Daily Multivitamin & Zinc Capsules (Demo)',
        slug: 'daily-multivitamin-zinc-capsules-demo',
        genericName: 'Multivitamin + Zinc + Vitamin D3',
        brand: 'Konkan Vita',
        strength: '60 Capsules',
        composition: 'Vitamin C 40mg, Vitamin D3 400IU, Zinc 12mg, B-Complex',
        dosageForm: 'Capsule',
        packSize: 'Bottle of 60 Capsules',
        scheduleType: 'OTC',
        rx: 0,
        mrp: 39900,
        sale: 32900,
        gst: 18,
        cat: 'cat-vitamins',
        sub: 'sub-vit-multi',
        mfr: 'mfr-4',
        imgs: [imgWellness, imgTablets],
        stock: 48,
        expiry: '2028-02-28',
        batch: 'DEMO-VIT-60',
        featured: 1,
        essential: 1,
        restricted: 0,
        recalled: 0,
        storage: 'Keep cap tightly closed in cool dry shelf.',
        usage: 'Pharmacist-approved daily nutritional supplement.',
        sideEffects: 'None expected at label usage.',
        safety: 'Health supplement — not a substitute for varied diet.',
      },
      {
        id: 'med-10',
        sku: 'DEMO-BPM-001',
        barcode: '890100000110',
        name: 'Digital BP Monitor + Thermometer Kit (Demo)',
        slug: 'digital-bp-monitor-thermometer-kit-demo',
        genericName: 'Automated Oscillometric Sphygmomanometer',
        brand: 'Western MedTech',
        strength: 'Cuff 22–42 cm',
        composition: 'Upper-Arm Monitor + Digital Clinical Thermometer',
        dosageForm: 'Medical Device',
        packSize: '1 Unit Kit',
        scheduleType: 'OTC',
        rx: 0,
        mrp: 199900,
        sale: 164900,
        gst: 12,
        cat: 'cat-devices',
        sub: 'sub-dev-monitors',
        mfr: 'mfr-3',
        imgs: [imgWellness],
        stock: 14,
        expiry: '2029-12-31',
        batch: 'DEMO-DEV-02',
        featured: 1,
        essential: 0,
        restricted: 0,
        recalled: 0,
        storage: 'Store inside pouch; remove batteries for long-term storage.',
        usage: 'Home blood pressure and body temperature measurement device.',
        sideEffects: 'N/A (External device)',
        safety: 'Follow enclosed user manual calibration instructions.',
      },
      {
        id: 'med-11',
        sku: 'DEMO-FA-KIT',
        barcode: '890100000111',
        name: 'Sterile Gauze, Antiseptic & Bandages Pack (Demo)',
        slug: 'sterile-gauze-antiseptic-bandages-demo',
        genericName: 'Chlorhexidine Antiseptic + Sterile Cotton Gauze',
        brand: 'Western MedTech',
        strength: '3-Piece Kit',
        composition: '100ml Antiseptic + 1 Gauze Roll + 30 Adhesive Bandages',
        dosageForm: 'First Aid Kit',
        packSize: 'Combo Pack (3 Items)',
        scheduleType: 'OTC',
        rx: 0,
        mrp: 21000,
        sale: 17500,
        gst: 12,
        cat: 'cat-first-aid',
        sub: 'sub-fa-dressings',
        mfr: 'mfr-3',
        imgs: [imgFirstAid],
        stock: 52,
        expiry: '2028-05-31',
        batch: 'DEMO-FA-11',
        featured: 0,
        essential: 1,
        restricted: 0,
        recalled: 0,
        storage: 'Store sterile packs sealed at room temperature.',
        usage: 'Home and travel first-aid dressing essentials.',
        sideEffects: 'External use only.',
        safety: 'Discontinue if skin irritation develops.',
      },
      {
        id: 'med-12',
        sku: 'DEMO-ANT-030',
        barcode: '890100000112',
        name: 'Antiseptic Skin Cleansing Lotion 100ml (Demo)',
        slug: 'antiseptic-skin-cleansing-lotion-demo',
        genericName: 'Cetrimide + Chlorhexidine Gluconate Solution',
        brand: 'Apex Care',
        strength: '0.3% / 0.6% w/v',
        composition: 'Chlorhexidine Gluconate 0.3% w/v + Cetrimide 0.6% w/v',
        dosageForm: 'Topical Solution',
        packSize: 'Bottle of 100 ml',
        scheduleType: 'OTC',
        rx: 0,
        mrp: 9800,
        sale: 8500,
        gst: 12,
        cat: 'cat-skin',
        sub: 'sub-skin-topical',
        mfr: 'mfr-1',
        imgs: [imgFirstAid, imgSyrup],
        stock: 9,
        expiry: '2027-06-28',
        batch: 'DEMO-TOP-03',
        featured: 0,
        essential: 1,
        restricted: 0,
        recalled: 0,
        storage: 'External use only. Keep away from eyes.',
        usage: 'Topical skin cleansing lotion.',
        sideEffects: 'Mild transient stinging on open skin.',
        safety: 'For external topical use only.',
      },
      {
        id: 'med-13',
        sku: 'DEMO-EYE-010',
        barcode: '890100000113',
        name: 'Carboxymethylcellulose Lubricating Eye Drops 10ml (Demo)',
        slug: 'cmc-lubricating-eye-drops-10ml-demo',
        genericName: 'Carboxymethylcellulose Sodium 0.5% w/v',
        brand: 'Apex Ophthal',
        strength: '0.5% w/v',
        composition: 'Carboxymethylcellulose Sodium IP 0.5% w/v',
        dosageForm: 'Eye Drops',
        packSize: 'Dropper Vial of 10 ml',
        scheduleType: 'OTC',
        rx: 0,
        mrp: 13500,
        sale: 11200,
        gst: 12,
        cat: 'cat-eye-ear',
        sub: 'sub-eye-drops',
        mfr: 'mfr-1',
        imgs: [imgSyrup],
        stock: 0,
        expiry: '2028-04-30',
        batch: 'DEMO-EYE-01',
        featured: 0,
        essential: 0,
        restricted: 0,
        recalled: 0,
        storage: 'Use within 30 days of opening cap.',
        usage: 'Out-of-stock demonstration listing to test Request Availability.',
        sideEffects: 'Brief mild blurring immediately after instillation.',
        safety: 'Do not touch dropper tip to any surface.',
      },
      {
        id: 'med-14',
        sku: 'DEMO-SAN-250',
        barcode: '890100000114',
        name: 'Hand Sanitizer & Surgical Mask Bundle (Demo)',
        slug: 'hand-sanitizer-surgical-mask-bundle-demo',
        genericName: 'Isopropyl Alcohol 70% Rub + 3-Ply Masks',
        brand: 'Western MedTech',
        strength: '250 ml + 10 Masks',
        composition: '70% Isopropyl Alcohol Gel + Non-woven 3-Ply Masks',
        dosageForm: 'Hygiene Kit',
        packSize: '250 ml + 10 Units',
        scheduleType: 'OTC',
        rx: 0,
        mrp: 19000,
        sale: 15500,
        gst: 18,
        cat: 'cat-essentials',
        sub: 'sub-ess-hygiene',
        mfr: 'mfr-3',
        imgs: [imgFirstAid],
        stock: 75,
        expiry: '2028-09-30',
        batch: 'DEMO-ESS-01',
        featured: 0,
        essential: 1,
        restricted: 0,
        recalled: 0,
        storage: 'Flammable liquid — store away from open flame.',
        usage: 'Pharmacy daily hygiene essentials.',
        sideEffects: 'External use only.',
        safety: 'Keep out of reach of children.',
      },
    ];

    for (const m of demoMeds) {
      const targetCatId = resolvedCategoryId.get(m.cat) || m.cat;
      const targetSubId = resolvedSubcategoryId.get(m.sub) || m.sub;

      const existingRow = sqlite
        .prepare('SELECT id, brand FROM medicines WHERE id = ?')
        .get(m.id) as { id: string; brand: string | null } | undefined;

      if (!existingRow) {
        sqlite
          .prepare(
            `INSERT INTO medicines (
              id, business_id, category_id, subcategory_id, manufacturer_id, sku, barcode, name, slug,
              generic_name, brand, strength, composition, dosage_form, pack_size, schedule_type, requires_prescription,
              mrp_paise, sale_price_paise, gst_percent, hsn_code, storage_instructions, usage_summary,
              side_effects_summary, safety_advice, is_active, is_demo_data, is_featured, is_essential,
              is_pharmacist_approved, is_recalled, online_sale_restricted, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            m.id,
            businessId,
            targetCatId,
            targetSubId,
            m.mfr,
            m.sku,
            m.barcode,
            m.name,
            m.slug,
            m.genericName,
            m.brand,
            m.strength,
            m.composition,
            m.dosageForm,
            m.packSize,
            m.scheduleType,
            m.rx,
            m.mrp,
            m.sale,
            m.gst,
            '30049099',
            m.storage,
            m.usage,
            m.sideEffects,
            m.safety,
            1,
            1,
            m.featured,
            m.essential,
            1,
            m.recalled,
            m.restricted,
            now,
            now
          );

        m.imgs.forEach((imgUrl, idx) => {
          sqlite
            .prepare(
              `INSERT INTO medicine_images (id, medicine_id, image_url, alt_text, is_primary, sort_order, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(crypto.randomUUID(), m.id, imgUrl, `${m.name} view ${idx + 1}`, idx === 0 ? 1 : 0, idx, now);
        });

        const batchId = `batch-${m.id}`;
        sqlite
          .prepare(
            `INSERT INTO medicine_batches (
              id, store_id, medicine_id, supplier_id, batch_number, expiry_date,
              quantity_received, quantity_available, purchase_price_paise, mrp_paise, is_demo_data, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            batchId,
            storeId,
            m.id,
            supId,
            m.batch,
            m.expiry,
            m.stock + 20,
            m.stock,
            Math.round(m.sale * 0.72),
            m.mrp,
            1,
            now,
            now
          );

        sqlite
          .prepare(
            `INSERT INTO inventory_transactions (id, store_id, batch_id, txn_type, quantity_delta, reference_type, reference_id, notes, performed_by_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            storeId,
            batchId,
            'OPENING_STOCK',
            m.stock,
            'SEED',
            m.sku,
            'Initial demonstration batch stock',
            '33333333-3333-4333-8333-333333333303',
            now
          );
      } else if (!existingRow.brand) {
        sqlite
          .prepare(
            `UPDATE medicines
             SET category_id = ?, subcategory_id = ?, barcode = ?, brand = ?, strength = ?,
                 is_featured = ?, is_essential = ?, is_pharmacist_approved = 1, updated_at = ?
             WHERE id = ?`
          )
          .run(targetCatId, targetSubId, m.barcode, m.brand, m.strength, m.featured, m.essential, now, m.id);

        const imgCount = sqlite
          .prepare('SELECT COUNT(*) as c FROM medicine_images WHERE medicine_id = ?')
          .get(m.id) as { c: number };
        if (imgCount.c < m.imgs.length) {
          m.imgs.slice(imgCount.c).forEach((imgUrl, idx) => {
            sqlite
              .prepare(
                `INSERT INTO medicine_images (id, medicine_id, image_url, alt_text, is_primary, sort_order, created_at)
                 VALUES (?, ?, ?, ?, 0, ?, ?)`
              )
              .run(crypto.randomUUID(), m.id, imgUrl, `${m.name} view ${imgCount.c + idx + 1}`, imgCount.c + idx, now);
          });
        }
      }
    }

    // Deactivate legacy cat-1..cat-8 if empty after remapping
    sqlite.exec(
      `UPDATE categories SET is_active = 0
       WHERE id IN ('cat-1','cat-2','cat-3','cat-4','cat-5','cat-6','cat-7','cat-8')
         AND NOT EXISTS (SELECT 1 FROM medicines WHERE category_id = categories.id)`
    );

    // Sample orders (only insert if not already seeded)
    const existingOrder = sqlite.prepare("SELECT id FROM orders WHERE id = '66666666-6666-4666-8666-666666666601'").get();
    if (!existingOrder) {
    const customerId = '33333333-3333-4333-8333-333333333305';
    const customerAddressId = '44444444-4444-4444-8444-444444444401';
    const deliveryPartnerId = '55555555-5555-4555-8555-555555555501';

    const order1Id = '66666666-6666-4666-8666-666666666601';
    sqlite
      .prepare(
        `INSERT INTO orders (
          id, store_id, user_id, address_id, order_number, status, prescription_status,
          subtotal_paise, discount_paise, delivery_fee_paise, tax_paise, total_paise,
          payment_method, payment_status, delivery_notes, delivery_otp, is_demo_data, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        order1Id,
        storeId,
        customerId,
        customerAddressId,
        'SLM-2026-1001',
        'OUT_FOR_DELIVERY',
        'NOT_REQUIRED',
        38700,
        0,
        2500,
        4264,
        41200,
        'RAZORPAY_TEST',
        'PAID',
        'Call on arrival at B-wing gate',
        '4829',
        1,
        now,
        now
      );

    sqlite
      .prepare(
        `INSERT INTO order_items (id, order_id, medicine_id, batch_id, medicine_name, pack_size, quantity, unit_price_paise, mrp_paise, tax_paise, line_total_paise, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), order1Id, 'med-01', 'batch-med-01', 'Paracetamol 500mg Tablets (Demo)', 'Strip of 15 Tablets', 2, 2900, 3500, 621, 5800, now);
    sqlite
      .prepare(
        `INSERT INTO order_items (id, order_id, medicine_id, batch_id, medicine_name, pack_size, quantity, unit_price_paise, mrp_paise, tax_paise, line_total_paise, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), order1Id, 'med-09', 'batch-med-09', 'Daily Multivitamin & Zinc Capsules (Demo)', 'Bottle of 60 Capsules', 1, 32900, 39900, 5018, 32900, now);

    sqlite
      .prepare('INSERT INTO order_status_history (id, order_id, status, note, changed_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), order1Id, 'PENDING_CONFIRMATION', 'Order received by pharmacy', customerId, now);
    sqlite
      .prepare('INSERT INTO order_status_history (id, order_id, status, note, changed_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), order1Id, 'OUT_FOR_DELIVERY', 'Dispatched from Hatkesh Road store', '33333333-3333-4333-8333-333333333301', now);

    sqlite
      .prepare(
        `INSERT INTO delivery_assignments (id, store_id, order_id, delivery_partner_id, status, assigned_at, picked_up_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), storeId, order1Id, deliveryPartnerId, 'OUT_FOR_DELIVERY', now, now, now);

    sqlite
      .prepare(
        `INSERT INTO payments (id, order_id, method, status, amount_paise, provider_reference, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), order1Id, 'RAZORPAY_TEST', 'PAID', 41200, 'rzp_test_demo_994012', now, now, now);

    sqlite
      .prepare(
        `INSERT INTO invoices (id, order_id, invoice_number, subtotal_paise, tax_paise, discount_paise, total_paise, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), order1Id, 'INV-SLM-2026-1001', 38700, 4264, 0, 41200, now);

    const order2Id = '66666666-6666-4666-8666-666666666602';
    sqlite
      .prepare(
        `INSERT INTO orders (
          id, store_id, user_id, address_id, order_number, status, prescription_status,
          subtotal_paise, discount_paise, delivery_fee_paise, tax_paise, total_paise,
          payment_method, payment_status, delivery_notes, delivery_otp, is_demo_data, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        order2Id,
        storeId,
        customerId,
        customerAddressId,
        'SLM-2026-1002',
        'PENDING_PRESCRIPTION',
        'PENDING_REVIEW',
        21700,
        0,
        2500,
        2325,
        24200,
        'CASH_ON_DELIVERY',
        'PENDING',
        'Evening delivery preferred',
        '7714',
        1,
        now,
        now
      );
    sqlite
      .prepare(
        `INSERT INTO order_items (id, order_id, medicine_id, batch_id, medicine_name, pack_size, quantity, unit_price_paise, mrp_paise, tax_paise, line_total_paise, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), order2Id, 'med-05', 'batch-med-05', 'Metformin SR 500mg Tablets (Demo)', 'Strip of 20 Tablets', 1, 7900, 9400, 846, 7900, now);
    sqlite
      .prepare(
        `INSERT INTO order_items (id, order_id, medicine_id, batch_id, medicine_name, pack_size, quantity, unit_price_paise, mrp_paise, tax_paise, line_total_paise, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), order2Id, 'med-06', 'batch-med-06', 'Telmisartan 40mg Tablets (Demo)', 'Strip of 15 Tablets', 1, 13800, 16500, 1479, 13800, now);

    sqlite
      .prepare(
        `INSERT INTO prescriptions (id, store_id, user_id, order_id, file_url, file_mime_type, patient_name, doctor_name, contact_phone, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        '77777777-7777-4777-8777-777777777701',
        storeId,
        customerId,
        order2Id,
        '/api/prescriptions/demo-sample-svg',
        'image/svg+xml',
        'Ananya Deshmukh',
        'Dr. R. K. Kulkarni (MD)',
        '+919820000005',
        'Monthly maintenance prescription (Demonstration record)',
        'PENDING_REVIEW',
        now,
        now
      );

    sqlite
      .prepare(
        `INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        customerId,
        'Order SLM-2026-1001 Out for Delivery',
        'Your demonstration order is out for delivery with Vikram Yadav.',
        'ORDER_UPDATE',
        0,
        now
      );
  }
}

function ensurePrompt3SeedData(): void {
  const now = new Date().toISOString();
  const businessId = '11111111-1111-4111-8111-111111111111';
  const storeId = '22222222-2222-4222-8222-222222222222';
  const adminId = '33333333-3333-4333-8333-333333333301';

  // Ensure minimumOrderPaise setting exists
  sqlite
    .prepare(
      `INSERT INTO store_settings (id, store_id, key, value, updated_at)
       VALUES (?, ?, 'minimumOrderPaise', '0', ?)
       ON CONFLICT(store_id, key) DO NOTHING`
    )
    .run(crypto.randomUUID(), storeId, now);

  // Populate mfg_date and storage_conditions on existing demo batches if blank
  sqlite
    .prepare(
      `UPDATE medicine_batches
       SET mfg_date = COALESCE(mfg_date, '2025-09-01'),
           storage_conditions = COALESCE(storage_conditions, 'Store below 25°C in cool, dry place')
       WHERE store_id = ? AND (mfg_date IS NULL OR storage_conditions IS NULL)`
    )
    .run(storeId);

  // Add default legal policies if missing
  const defaultPolicies: Array<{ slug: string; title: string; content: string }> = [
    {
      slug: 'terms-of-service',
      title: 'Terms & Conditions',
      content:
        'All prescription medicines (Schedule H / H1) are dispensed strictly against a valid registered medical practitioner prescription verified by our licensed pharmacist at Shree Leela Medical & General Stores, Mira Road East.',
    },
    {
      slug: 'privacy-policy',
      title: 'Privacy & Prescription Data Policy',
      content:
        'Customer prescriptions and medical inquiries are accessible solely to authorized registered pharmacists and store compliance staff for dispensing and statutory record-keeping.',
    },
    {
      slug: 'refund-cancellation-policy',
      title: 'Refund & Cancellation Policy',
      content:
        'Orders may be cancelled before dispatch with a documented reason. Opened strips, cold-chain items, and dispensed prescription medicines are non-returnable unless damaged or incorrectly supplied.',
    },
    {
      slug: 'prescription-compliance-policy',
      title: 'Prescription Compliance Policy',
      content:
        'Online sale of restricted drugs requires physical verification by our registered pharmacist. Automated tools never approve clinical prescriptions.',
    },
  ];
  for (const pol of defaultPolicies) {
    sqlite
      .prepare(
        `INSERT INTO legal_policies (id, store_id, slug, title, content, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(store_id, slug) DO NOTHING`
      )
      .run(crypto.randomUUID(), storeId, pol.slug, pol.title, pol.content, adminId, now);
  }

  // Add 2nd demo supplier
  const sup2Id = 'sup-2';
  const existingSup2 = sqlite.prepare('SELECT id FROM suppliers WHERE id = ?').get(sup2Id);
  if (!existingSup2) {
    sqlite
      .prepare(
        `INSERT INTO suppliers (id, business_id, name, contact_name, phone, email, gstin, drug_license, address, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sup2Id,
        businessId,
        'Sahyadri Pharma Agencies (Demo)',
        'Priya Sawant',
        '+919820088811',
        'orders@sahyadriagencies.example',
        '27AAACS0000C1Z8',
        'MH-THN-WH-DEMO-21B',
        'Bhayandar East Industrial Hub, Thane',
        now,
        now
      );
  }

  // Add 2nd demo delivery partner for multi-rider dispatch & reassignment testing
  const partner2UserId = '33333333-3333-4333-8333-333333333307';
  const existingPartner2 = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(partner2UserId);
  if (!existingPartner2) {
    const hash = bcrypt.hashSync('RiderPass@123', 10);
    sqlite
      .prepare(
        `INSERT INTO users (id, business_id, email, phone, full_name, password_hash, is_email_verified, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
      )
      .run(partner2UserId, businessId, 'delivery2.demo@shreeleela.example', '+919820000007', 'Arjun Patil (Demo Rider)', hash, now, now);

    sqlite
      .prepare('INSERT INTO user_roles (id, user_id, store_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), partner2UserId, storeId, 'DELIVERY_PARTNER', adminId, now);

    sqlite
      .prepare(
        `INSERT INTO delivery_partners (
          id, user_id, store_id, vehicle_type, vehicle_number, license_number,
          is_available, is_on_shift, account_status, current_lat, current_lng, location_accuracy_m, last_location_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'ACTIVE', 19.2819, 72.8778, 12.0, ?, ?, ?)`
      )
      .run(
        '55555555-5555-4555-8555-555555555502',
        partner2UserId,
        storeId,
        'Scooter',
        'MH-04-DEMO-7290',
        'MH04-2022-DEMO-440',
        now,
        now,
        now
      );
  }

  // Seed 2 realistic demo Purchase Orders if none exist
  const existingPo = sqlite.prepare('SELECT id FROM purchase_orders WHERE store_id = ? LIMIT 1').get(storeId);
  if (!existingPo) {
    const med1 = sqlite.prepare("SELECT id FROM medicines WHERE id = 'med-01'").get() as { id: string } | undefined;
    const med5 = sqlite.prepare("SELECT id FROM medicines WHERE id = 'med-05'").get() as { id: string } | undefined;
    if (med1 && med5) {
      const po1Id = 'po-demo-1001';
      sqlite
        .prepare(
          `INSERT INTO purchase_orders (id, store_id, supplier_id, po_number, status, expected_date, subtotal_paise, paid_paise, payment_status, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          po1Id,
          storeId,
          'sup-1',
          'PO-SLM-2026-001',
          'RECEIVED',
          now.slice(0, 10),
          145000,
          145000,
          'PAID',
          'Monthly OTC stock replenishment (Demo)',
          adminId,
          now,
          now
        );
      sqlite
        .prepare(
          `INSERT INTO purchase_order_items (id, purchase_order_id, medicine_id, quantity_ordered, quantity_received, unit_cost_paise, batch_number, mfg_date, expiry_date, mrp_paise)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(crypto.randomUUID(), po1Id, med1.id, 60, 60, 2417, 'BATCH-PAR-01', '2025-09-01', '2028-04-30', 3500);
      sqlite
        .prepare(
          `INSERT INTO supplier_payments (id, purchase_order_id, supplier_id, amount_paise, method, reference, paid_by, paid_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(crypto.randomUUID(), po1Id, 'sup-1', 145000, 'NEFT', 'UTR-DEMO-781902', adminId, now);

      const po2Id = 'po-demo-1002';
      sqlite
        .prepare(
          `INSERT INTO purchase_orders (id, store_id, supplier_id, po_number, status, expected_date, subtotal_paise, paid_paise, payment_status, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          po2Id,
          storeId,
          'sup-2',
          'PO-SLM-2026-002',
          'ORDERED',
          new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
          198000,
          0,
          'UNPAID',
          'Diabetes maintenance restock awaiting GRN',
          adminId,
          now,
          now
        );
      sqlite
        .prepare(
          `INSERT INTO purchase_order_items (id, purchase_order_id, medicine_id, quantity_ordered, quantity_received, unit_cost_paise, batch_number, mfg_date, expiry_date, mrp_paise)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(crypto.randomUUID(), po2Id, med5.id, 30, 0, 6600, 'MET-NEW-26', '2026-02-01', '2028-08-31', 9400);
    }
  }
}

function ensurePrompt5SeedData(): void {
  const now = new Date().toISOString();
  const storeId = '22222222-2222-4222-8222-222222222222';

  // Ensure default pharmacist info on store row if unset
  sqlite
    .prepare(
      `UPDATE stores
       SET pharmacist_name = COALESCE(pharmacist_name, 'Dr. Kavita Joshi (Registered Pharmacist)'),
           pharmacist_reg_number = COALESCE(pharmacist_reg_number, 'MH-PHARM-DEMO-4812')
       WHERE id = ?`
    )
    .run(storeId);

  // Ensure productionSalesEnabled defaults to false for compliance safety
  sqlite
    .prepare(
      `INSERT INTO store_settings (id, store_id, key, value, updated_at)
       VALUES (?, ?, 'productionSalesEnabled', 'false', ?)
       ON CONFLICT(store_id, key) DO NOTHING`
    )
    .run(crypto.randomUUID(), storeId, now);

  // Ensure onboarding state record exists
  sqlite
    .prepare(
      `INSERT INTO store_onboarding_state (store_id, current_step, steps_completed_json, compliance_signed_off, production_sales_enabled, updated_at)
       VALUES (?, 1, '{}', 0, 0, ?)
       ON CONFLICT(store_id) DO NOTHING`
    )
    .run(storeId, now);

  // Normalize any legacy statuses inserted during seeding
  sqlite.exec(`
    UPDATE orders SET status = 'ORDER_RECEIVED' WHERE status = 'PENDING_CONFIRMATION';
    UPDATE orders SET status = 'PRESCRIPTION_PENDING' WHERE status = 'PENDING_PRESCRIPTION';
    UPDATE orders SET status = 'PREPARING' WHERE status = 'PACKING';
    UPDATE order_status_history SET status = 'ORDER_RECEIVED' WHERE status = 'PENDING_CONFIRMATION';
    UPDATE order_status_history SET status = 'PRESCRIPTION_PENDING' WHERE status = 'PENDING_PRESCRIPTION';
    UPDATE order_status_history SET status = 'PREPARING' WHERE status = 'PACKING';
  `);
}
