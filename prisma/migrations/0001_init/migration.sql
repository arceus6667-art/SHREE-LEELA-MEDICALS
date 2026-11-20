-- Migration: 0001_init
-- Shree Leela Medical & General Stores — PostgreSQL Relational Schema
-- Monetary values stored as integer paise (INR * 100).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'STORE_ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'DELIVERY_PARTNER', 'CUSTOMER');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PRESCRIPTION', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PACKING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');
CREATE TYPE "PrescriptionStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CLARIFICATION_NEEDED');
CREATE TYPE "PaymentMethod" AS ENUM ('UPI', 'CARD', 'NETBANKING', 'CASH_ON_DELIVERY');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');
CREATE TYPE "DeliveryAssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED');
CREATE TYPE "InventoryTxnType" AS ENUM ('OPENING_STOCK', 'PURCHASE_RECEIPT', 'SALE_DISPATCH', 'RETURN_RESTOCK', 'EXPIRED_WRITEOFF', 'MANUAL_ADJUSTMENT');

CREATE TABLE "Business" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "gstin" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Store" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL,
  "landmark" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'India',
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "operatingHours" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "googleMapsUrl" TEXT,
  "drugLicenseNumber" TEXT,
  "logoPlaceholder" BOOLEAN NOT NULL DEFAULT true,
  "logoUrl" TEXT,
  "storefrontPhotoUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Store_businessId_idx" ON "Store"("businessId");

CREATE TABLE "User" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL UNIQUE,
  "phone" TEXT UNIQUE,
  "fullName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "User_businessId_idx" ON "User"("businessId");

CREATE TABLE "UserRole" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "storeId" UUID REFERENCES "Store"("id") ON DELETE CASCADE,
  "role" "Role" NOT NULL,
  "assignedBy" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("userId", "storeId", "role")
);
CREATE INDEX "UserRole_role_idx" ON "UserRole"("role");

CREATE TABLE "CustomerProfile" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "dateOfBirth" TIMESTAMPTZ,
  "allergiesNote" TEXT,
  "chronicConditions" TEXT,
  "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
  "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "EmployeeProfile" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "storeId" UUID NOT NULL REFERENCES "Store"("id") ON DELETE CASCADE,
  "employeeCode" TEXT NOT NULL UNIQUE,
  "designation" TEXT NOT NULL,
  "pharmacistRegNumber" TEXT,
  "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "EmployeeProfile_storeId_idx" ON "EmployeeProfile"("storeId");

CREATE TABLE "DeliveryPartner" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "storeId" UUID NOT NULL REFERENCES "Store"("id") ON DELETE CASCADE,
  "vehicleType" TEXT NOT NULL,
  "vehicleNumber" TEXT NOT NULL,
  "licenseNumber" TEXT,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "isOnShift" BOOLEAN NOT NULL DEFAULT false,
  "currentLat" DOUBLE PRECISION,
  "currentLng" DOUBLE PRECISION,
  "lastLocationAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "DeliveryPartner_storeId_isAvailable_idx" ON "DeliveryPartner"("storeId", "isAvailable");

CREATE TABLE "Address" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "label" TEXT NOT NULL,
  "recipientName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "line1" TEXT NOT NULL,
  "line2" TEXT,
  "landmark" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Address_userId_idx" ON "Address"("userId");

CREATE TABLE "Category" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Subcategory" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "categoryId" UUID NOT NULL REFERENCES "Category"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Manufacturer" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'India',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("businessId", "name")
);

CREATE TABLE "Medicine" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "categoryId" UUID NOT NULL REFERENCES "Category"("id"),
  "subcategoryId" UUID REFERENCES "Subcategory"("id"),
  "manufacturerId" UUID NOT NULL REFERENCES "Manufacturer"("id"),
  "sku" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "genericName" TEXT NOT NULL,
  "composition" TEXT NOT NULL,
  "dosageForm" TEXT NOT NULL,
  "packSize" TEXT NOT NULL,
  "scheduleType" TEXT NOT NULL DEFAULT 'OTC',
  "requiresPrescription" BOOLEAN NOT NULL DEFAULT false,
  "mrpPaise" INTEGER NOT NULL,
  "salePricePaise" INTEGER NOT NULL,
  "gstPercent" INTEGER NOT NULL DEFAULT 12,
  "hsnCode" TEXT,
  "storageInstructions" TEXT,
  "usageSummary" TEXT,
  "sideEffectsSummary" TEXT,
  "safetyAdvice" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDemoData" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Medicine_businessId_categoryId_idx" ON "Medicine"("businessId", "categoryId");

CREATE TABLE "MedicineImage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "medicineId" UUID NOT NULL REFERENCES "Medicine"("id") ON DELETE CASCADE,
  "imageUrl" TEXT NOT NULL,
  "altText" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Supplier" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "contactName" TEXT,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "gstin" TEXT,
  "drugLicense" TEXT,
  "address" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "MedicineBatch" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL REFERENCES "Store"("id") ON DELETE CASCADE,
  "medicineId" UUID NOT NULL REFERENCES "Medicine"("id") ON DELETE CASCADE,
  "supplierId" UUID REFERENCES "Supplier"("id"),
  "batchNumber" TEXT NOT NULL,
  "expiryDate" TIMESTAMPTZ NOT NULL,
  "quantityReceived" INTEGER NOT NULL,
  "quantityAvailable" INTEGER NOT NULL,
  "purchasePricePaise" INTEGER NOT NULL,
  "mrpPaise" INTEGER NOT NULL,
  "isDemoData" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("storeId", "medicineId", "batchNumber")
);
CREATE INDEX "MedicineBatch_storeId_expiryDate_idx" ON "MedicineBatch"("storeId", "expiryDate");

CREATE TABLE "InventoryTransaction" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL REFERENCES "Store"("id") ON DELETE CASCADE,
  "batchId" UUID NOT NULL REFERENCES "MedicineBatch"("id") ON DELETE CASCADE,
  "txnType" "InventoryTxnType" NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "notes" TEXT,
  "performedById" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Cart" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL REFERENCES "Store"("id") ON DELETE CASCADE,
  "userId" UUID REFERENCES "User"("id") ON DELETE CASCADE,
  "guestKey" TEXT UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "CartItem" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "cartId" UUID NOT NULL REFERENCES "Cart"("id") ON DELETE CASCADE,
  "medicineId" UUID NOT NULL REFERENCES "Medicine"("id") ON DELETE CASCADE,
  "quantity" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("cartId", "medicineId")
);

CREATE TABLE "Coupon" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "code" TEXT NOT NULL UNIQUE,
  "description" TEXT NOT NULL,
  "discountType" TEXT NOT NULL,
  "discountValue" INTEGER NOT NULL,
  "minOrderPaise" INTEGER NOT NULL DEFAULT 0,
  "maxDiscountPaise" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Order" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL REFERENCES "Store"("id"),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "addressId" UUID REFERENCES "Address"("id"),
  "couponId" UUID REFERENCES "Coupon"("id"),
  "orderNumber" TEXT NOT NULL UNIQUE,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "prescriptionStatus" "PrescriptionStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "subtotalPaise" INTEGER NOT NULL,
  "discountPaise" INTEGER NOT NULL DEFAULT 0,
  "deliveryFeePaise" INTEGER NOT NULL DEFAULT 0,
  "taxPaise" INTEGER NOT NULL DEFAULT 0,
  "totalPaise" INTEGER NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL,
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryNotes" TEXT,
  "deliveryOtp" TEXT,
  "isDemoData" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Order_storeId_status_idx" ON "Order"("storeId", "status");

CREATE TABLE "OrderItem" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "medicineId" UUID NOT NULL REFERENCES "Medicine"("id"),
  "batchId" UUID REFERENCES "MedicineBatch"("id"),
  "medicineName" TEXT NOT NULL,
  "packSize" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPricePaise" INTEGER NOT NULL,
  "mrpPaise" INTEGER NOT NULL,
  "taxPaise" INTEGER NOT NULL,
  "lineTotalPaise" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "OrderStatusHistory" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "status" "OrderStatus" NOT NULL,
  "note" TEXT,
  "changedById" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Prescription" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL REFERENCES "Store"("id"),
  "userId" UUID NOT NULL REFERENCES "User"("id"),
  "orderId" UUID REFERENCES "Order"("id"),
  "fileUrl" TEXT NOT NULL,
  "fileMimeType" TEXT NOT NULL,
  "patientName" TEXT NOT NULL,
  "doctorName" TEXT,
  "notes" TEXT,
  "status" "PrescriptionStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "PrescriptionReview" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "prescriptionId" UUID NOT NULL REFERENCES "Prescription"("id") ON DELETE CASCADE,
  "pharmacistId" UUID NOT NULL REFERENCES "User"("id"),
  "decision" "PrescriptionStatus" NOT NULL,
  "remarks" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "DeliveryAssignment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL REFERENCES "Store"("id"),
  "orderId" UUID NOT NULL UNIQUE REFERENCES "Order"("id") ON DELETE CASCADE,
  "deliveryPartnerId" UUID NOT NULL REFERENCES "DeliveryPartner"("id"),
  "status" "DeliveryAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
  "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "pickedUpAt" TIMESTAMPTZ,
  "deliveredAt" TIMESTAMPTZ,
  "proofNote" TEXT,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "DriverLocation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "deliveryPartnerId" UUID NOT NULL REFERENCES "DeliveryPartner"("id") ON DELETE CASCADE,
  "orderId" UUID,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "heading" DOUBLE PRECISION,
  "speedKmh" DOUBLE PRECISION,
  "recordedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Payment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL,
  "amountPaise" INTEGER NOT NULL,
  "providerReference" TEXT,
  "paidAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Refund" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "paymentId" UUID NOT NULL REFERENCES "Payment"("id") ON DELETE CASCADE,
  "amountPaise" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSED',
  "processedBy" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Invoice" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL UNIQUE REFERENCES "Order"("id") ON DELETE CASCADE,
  "invoiceNumber" TEXT NOT NULL UNIQUE,
  "subtotalPaise" INTEGER NOT NULL,
  "taxPaise" INTEGER NOT NULL,
  "discountPaise" INTEGER NOT NULL,
  "totalPaise" INTEGER NOT NULL,
  "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Notification" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "SupportTicket" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL REFERENCES "Store"("id"),
  "userId" UUID REFERENCES "User"("id"),
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "AuditLog" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "businessId" UUID NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "storeId" UUID REFERENCES "Store"("id"),
  "actorUserId" UUID REFERENCES "User"("id"),
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "StoreSetting" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "storeId" UUID NOT NULL REFERENCES "Store"("id") ON DELETE CASCADE,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("storeId", "key")
);
