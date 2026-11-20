import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import type { IDatabaseService } from '../interfaces/services.ts';

const DB_PATH = path.resolve(process.env.SQLITE_DATABASE_PATH || 'data/shree_leela_live.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

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

export function initializeDatabase(): void {
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
      is_demo_data INTEGER NOT NULL DEFAULT 0,
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
      is_demo_data INTEGER NOT NULL DEFAULT 0,
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
      is_demo_data INTEGER NOT NULL DEFAULT 0,
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

  const legacyDemoAccount = sqlite
    .prepare("SELECT 1 FROM users WHERE email LIKE '%.demo@shreeleela.example' LIMIT 1")
    .get();
  if (legacyDemoAccount) {
    throw new Error('This SQLite file contains sample accounts. Use a new SQLITE_DATABASE_PATH for the pharmacy workspace.');
  }

  if (!sqlite.prepare('SELECT id FROM businesses LIMIT 1').get()) {
    provisionStore();
  }
  bootstrapAdmin();
}

function provisionStore(): void {
  const now = new Date().toISOString();
  const businessId = crypto.randomUUID();
  const storeId = crypto.randomUUID();
  const name = 'Shree Leela Medical & General Stores';
  const categories: Array<{
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
    {
      id: 'cat-baby-care',
      name: 'Baby Care',
      slug: 'baby-care',
      desc: 'Baby toiletries, hygiene and daily care essentials',
      order: 14,
      subs: [],
    },
  ];


  databaseService.withTransaction(() => {
    if (sqlite.prepare('SELECT id FROM businesses LIMIT 1').get()) return;
    sqlite
      .prepare('INSERT INTO businesses (id, name, currency, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(businessId, name, 'INR', 'Asia/Kolkata', now, now);
    sqlite
      .prepare(`INSERT INTO stores (
        id, business_id, code, name, address_line1, landmark, city, state, postal_code,
        phone, operating_hours, latitude, longitude, google_maps_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(storeId, businessId, 'SLM-MIRA-01', name, 'Gaurav Avenue, Hatkesh Road',
        'Near GCC Club', 'Mira Road East', 'Maharashtra', '401107', '+91 72082 82337',
        '8 AM to 11 PM', 19.2813, 72.8782, 'https://maps.app.goo.gl/t2GPkm2kVdTe4Cw46', now, now);
    sqlite
      .prepare(`INSERT INTO store_onboarding_state
        (store_id, current_step, steps_completed_json, compliance_signed_off, production_sales_enabled, updated_at)
        VALUES (?, 1, '{}', 0, 0, ?)`)
      .run(storeId, now);

    const insertCategory = sqlite.prepare(`INSERT INTO categories
      (id, business_id, name, slug, description, display_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`);
    const insertSubcategory = sqlite.prepare(`INSERT INTO subcategories
      (id, category_id, name, slug, description, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`);
    for (const category of categories) {
      insertCategory.run(category.id, businessId, category.name, category.slug, category.desc, category.order, now, now);
      for (const subcategory of category.subs) {
        insertSubcategory.run(subcategory.id, category.id, subcategory.name, subcategory.slug, category.desc, now, now);
      }
    }

  });
}

function bootstrapAdmin(): void {
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (Boolean(adminEmail) !== Boolean(adminPassword)) {
    throw new Error('Set both BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.');
  }
  if (adminEmail && (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail) || !adminPassword || adminPassword.length < 14 || Buffer.byteLength(adminPassword) > 72)) {
    throw new Error('Use a valid bootstrap email and a password of at least 14 characters and up to 72 bytes.');
  }

  if (!adminEmail || !adminPassword) return;

  databaseService.withTransaction(() => {
    const store = sqlite.prepare('SELECT id, business_id FROM stores WHERE is_active = 1 LIMIT 1')
      .get() as { id: string; business_id: string } | undefined;
    if (!store) return;
    const admin = sqlite.prepare("SELECT 1 FROM user_roles WHERE store_id = ? AND role IN ('STORE_ADMIN', 'SUPER_ADMIN') LIMIT 1")
      .get(store.id);
    if (admin) return;
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite.prepare(`INSERT INTO users
      (id, business_id, email, full_name, password_hash, is_email_verified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(userId, store.business_id, adminEmail, 'Store administrator', bcrypt.hashSync(adminPassword, 12), now, now);
    sqlite.prepare('INSERT INTO user_roles (id, user_id, store_id, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), userId, store.id, 'STORE_ADMIN', now);
  });
}
