export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  STORE_ADMIN: 'STORE_ADMIN',
  PHARMACIST: 'PHARMACIST',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  DELIVERY_PARTNER: 'DELIVERY_PARTNER',
  CUSTOMER: 'CUSTOMER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const OrderStatus = {
  ORDER_RECEIVED: 'ORDER_RECEIVED',
  PRESCRIPTION_PENDING: 'PRESCRIPTION_PENDING',
  PHARMACIST_REVIEW: 'PHARMACIST_REVIEW',
  APPROVED: 'APPROVED',
  CLARIFICATION_REQUIRED: 'CLARIFICATION_REQUIRED',
  REJECTED: 'REJECTED',
  AWAITING_CUSTOMER_ACCEPTANCE: 'AWAITING_CUSTOMER_ACCEPTANCE',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  PACKED: 'PACKED',
  READY_FOR_DISPATCH: 'READY_FOR_DISPATCH',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  COLLECTED: 'COLLECTED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export function normalizeLegacyOrderStatus(raw: string): OrderStatus {
  switch (raw) {
    case 'PENDING_CONFIRMATION':
      return OrderStatus.ORDER_RECEIVED;
    case 'PENDING_PRESCRIPTION':
      return OrderStatus.PRESCRIPTION_PENDING;
    case 'PACKING':
      return OrderStatus.PREPARING;
    default:
      return (Object.values(OrderStatus).includes(raw as OrderStatus)
        ? raw
        : OrderStatus.ORDER_RECEIVED) as OrderStatus;
  }
}

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.COLLECTED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
  OrderStatus.RETURNED,
];

export const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.ORDER_RECEIVED]: [
    OrderStatus.PRESCRIPTION_PENDING,
    OrderStatus.PAYMENT_PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PRESCRIPTION_PENDING]: [
    OrderStatus.PHARMACIST_REVIEW,
    OrderStatus.APPROVED,
    OrderStatus.CLARIFICATION_REQUIRED,
    OrderStatus.REJECTED,
    OrderStatus.AWAITING_CUSTOMER_ACCEPTANCE,
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PHARMACIST_REVIEW]: [
    OrderStatus.APPROVED,
    OrderStatus.CLARIFICATION_REQUIRED,
    OrderStatus.REJECTED,
    OrderStatus.AWAITING_CUSTOMER_ACCEPTANCE,
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.CLARIFICATION_REQUIRED]: [
    OrderStatus.PHARMACIST_REVIEW,
    OrderStatus.APPROVED,
    OrderStatus.REJECTED,
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.APPROVED]: [
    OrderStatus.AWAITING_CUSTOMER_ACCEPTANCE,
    OrderStatus.PAYMENT_PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.AWAITING_CUSTOMER_ACCEPTANCE]: [
    OrderStatus.PAYMENT_PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAYMENT_PENDING]: [
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.CONFIRMED]: [
    OrderStatus.PREPARING,
    OrderStatus.PACKED,
    OrderStatus.READY_FOR_DISPATCH,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PREPARING]: [
    OrderStatus.PACKED,
    OrderStatus.READY_FOR_DISPATCH,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PACKED]: [
    OrderStatus.READY_FOR_DISPATCH,
    OrderStatus.DRIVER_ASSIGNED,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.READY_FOR_DISPATCH]: [
    OrderStatus.DRIVER_ASSIGNED,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.DRIVER_ASSIGNED]: [
    OrderStatus.READY_FOR_DISPATCH,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERY_FAILED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.OUT_FOR_DELIVERY]: [
    OrderStatus.DELIVERED,
    OrderStatus.DELIVERY_FAILED,
    OrderStatus.RETURNED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.DELIVERY_FAILED]: [
    OrderStatus.DRIVER_ASSIGNED,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.RETURNED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.READY_FOR_PICKUP]: [
    OrderStatus.COLLECTED,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURNED],
  [OrderStatus.COLLECTED]: [OrderStatus.RETURNED],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.RETURNED]: [],
  [OrderStatus.CANCELLED]: [],
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  ORDER_RECEIVED: 'Order Received',
  PRESCRIPTION_PENDING: 'Prescription Pending',
  PHARMACIST_REVIEW: 'Pharmacist Review',
  APPROVED: 'Prescription Approved',
  CLARIFICATION_REQUIRED: 'Clarification Required',
  REJECTED: 'Prescription Rejected',
  AWAITING_CUSTOMER_ACCEPTANCE: 'Awaiting Customer Acceptance',
  PAYMENT_PENDING: 'Payment Pending',
  CONFIRMED: 'Order Confirmed',
  PREPARING: 'Preparing Order',
  PACKED: 'Packed',
  READY_FOR_DISPATCH: 'Ready for Dispatch',
  DRIVER_ASSIGNED: 'Driver Assigned',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  READY_FOR_PICKUP: 'Ready for Store Pickup',
  COLLECTED: 'Collected at Store',
  DELIVERY_FAILED: 'Delivery Failed',
  RETURNED: 'Returned to Pharmacy',
  CANCELLED: 'Cancelled',
};

export const PrescriptionStatus = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CLARIFICATION_NEEDED: 'CLARIFICATION_NEEDED',
} as const;
export type PrescriptionStatus = (typeof PrescriptionStatus)[keyof typeof PrescriptionStatus];

export const PaymentMethod = {
  RAZORPAY_TEST: 'RAZORPAY_TEST',
  UPI: 'UPI',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  CASH_ON_DELIVERY: 'CASH_ON_DELIVERY',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const DeliveryAssignmentStatus = {
  ASSIGNED: 'ASSIGNED',
  ACCEPTED: 'ACCEPTED',
  ARRIVED_AT_STORE: 'ARRIVED_AT_STORE',
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  ARRIVED_AT_CUSTOMER: 'ARRIVED_AT_CUSTOMER',
  DELIVERED: 'DELIVERED',
  ASSIGNMENT_REJECTED: 'ASSIGNMENT_REJECTED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RETURNING_TO_STORE: 'RETURNING_TO_STORE',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type DeliveryAssignmentStatus =
  (typeof DeliveryAssignmentStatus)[keyof typeof DeliveryAssignmentStatus];

export const TRACKABLE_ASSIGNMENT_STATUSES: DeliveryAssignmentStatus[] = [
  DeliveryAssignmentStatus.ACCEPTED,
  DeliveryAssignmentStatus.ARRIVED_AT_STORE,
  DeliveryAssignmentStatus.PICKED_UP,
  DeliveryAssignmentStatus.OUT_FOR_DELIVERY,
  DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER,
];

export const TERMINAL_ASSIGNMENT_STATUSES: DeliveryAssignmentStatus[] = [
  DeliveryAssignmentStatus.DELIVERED,
  DeliveryAssignmentStatus.ASSIGNMENT_REJECTED,
  DeliveryAssignmentStatus.RETURNED,
  DeliveryAssignmentStatus.CANCELLED,
  DeliveryAssignmentStatus.FAILED,
];

export const ALLOWED_DELIVERY_TRANSITIONS: Record<string, DeliveryAssignmentStatus[]> = {
  [DeliveryAssignmentStatus.ASSIGNED]: [
    DeliveryAssignmentStatus.ACCEPTED,
    DeliveryAssignmentStatus.ASSIGNMENT_REJECTED,
    DeliveryAssignmentStatus.CANCELLED,
  ],
  [DeliveryAssignmentStatus.ACCEPTED]: [
    DeliveryAssignmentStatus.ARRIVED_AT_STORE,
    DeliveryAssignmentStatus.DELIVERY_FAILED,
    DeliveryAssignmentStatus.CANCELLED,
  ],
  [DeliveryAssignmentStatus.ARRIVED_AT_STORE]: [
    DeliveryAssignmentStatus.PICKED_UP,
    DeliveryAssignmentStatus.DELIVERY_FAILED,
    DeliveryAssignmentStatus.CANCELLED,
  ],
  [DeliveryAssignmentStatus.PICKED_UP]: [
    DeliveryAssignmentStatus.OUT_FOR_DELIVERY,
    DeliveryAssignmentStatus.DELIVERY_FAILED,
    DeliveryAssignmentStatus.RETURNING_TO_STORE,
  ],
  [DeliveryAssignmentStatus.OUT_FOR_DELIVERY]: [
    DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER,
    DeliveryAssignmentStatus.DELIVERY_FAILED,
    DeliveryAssignmentStatus.RETURNING_TO_STORE,
  ],
  [DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER]: [
    DeliveryAssignmentStatus.DELIVERED,
    DeliveryAssignmentStatus.DELIVERY_FAILED,
    DeliveryAssignmentStatus.RETURNING_TO_STORE,
  ],
  [DeliveryAssignmentStatus.DELIVERY_FAILED]: [
    DeliveryAssignmentStatus.RETURNING_TO_STORE,
    DeliveryAssignmentStatus.OUT_FOR_DELIVERY,
  ],
  [DeliveryAssignmentStatus.RETURNING_TO_STORE]: [
    DeliveryAssignmentStatus.RETURNED,
  ],
  [DeliveryAssignmentStatus.ASSIGNMENT_REJECTED]: [],
  [DeliveryAssignmentStatus.DELIVERED]: [],
  [DeliveryAssignmentStatus.RETURNED]: [],
  [DeliveryAssignmentStatus.CANCELLED]: [],
  [DeliveryAssignmentStatus.FAILED]: [DeliveryAssignmentStatus.RETURNING_TO_STORE],
};

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  ASSIGNED: 'Assigned (Awaiting Partner)',
  ACCEPTED: 'Accepted by Partner',
  ARRIVED_AT_STORE: 'Arrived at Pharmacy',
  PICKED_UP: 'Picked Up from Pharmacy',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  ARRIVED_AT_CUSTOMER: 'Arrived at Customer Location',
  DELIVERED: 'Delivered',
  ASSIGNMENT_REJECTED: 'Assignment Rejected',
  DELIVERY_FAILED: 'Delivery Attempt Failed',
  RETURNING_TO_STORE: 'Returning to Pharmacy',
  RETURNED: 'Returned to Pharmacy',
  CANCELLED: 'Cancelled',
  FAILED: 'Delivery Failed',
};

export const FulfillmentType = {
  DELIVERY: 'DELIVERY',
  STORE_PICKUP: 'STORE_PICKUP',
} as const;
export type FulfillmentType = (typeof FulfillmentType)[keyof typeof FulfillmentType];

export const PublicationStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type PublicationStatus = (typeof PublicationStatus)[keyof typeof PublicationStatus];

export const PurchaseOrderStatus = {
  DRAFT: 'DRAFT',
  ORDERED: 'ORDERED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseOrderStatus = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

export type AppErrorCode =
  | 'PRODUCT_UNAVAILABLE'
  | 'STOCK_CHANGED'
  | 'INVALID_ADDRESS'
  | 'AREA_UNSERVICEABLE'
  | 'RX_REJECTED'
  | 'PAYMENT_FAILED'
  | 'SERVER_UNAVAILABLE'
  | 'GPS_DISCONNECTED'
  | 'SESSION_EXPIRED'
  | 'UNAUTHORIZED'
  | 'COMPLIANCE_BLOCKED'
  | 'UNKNOWN';

export interface NotificationPreferencesDTO {
  inApp: boolean;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  marketingConsent: boolean;
}

export interface OnboardingStepDTO {
  key: string;
  label: string;
  completed: boolean;
  detail: string;
}

export interface OnboardingStateDTO {
  storeId: string;
  currentStep: number;
  complianceSignedOff: boolean;
  signedOffBy: string | null;
  signedOffAt: string | null;
  productionSalesEnabled: boolean;
  demoMode: boolean;
  liveModeEligible: boolean;
  steps: OnboardingStepDTO[];
  blockers: string[];
}

export interface RazorpayOrderInitDTO {
  gatewayOrderId: string;
  orderId?: string;
  amountPaise: number;
  currency: 'INR';
  keyId: string;
  testMode: boolean;
  merchantName: string;
  prefill: {
    name: string;
    email: string;
    contact: string;
  };
}

export interface PublicStoreInfo {
  id: string;
  businessId: string;
  code: string;
  name: string;
  addressLine1: string;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string | null;
  operatingHours: string;
  latitude: number;
  longitude: number;
  googleMapsUrl: string;
  drugLicenseNumber: string | null;
  pharmacistName?: string | null;
  pharmacistRegNumber?: string | null;
  gstin: string | null;
  currency: string;
  timezone: string;
  logoPlaceholder: boolean;
  logoUrl: string | null;
  storefrontPhotoUrl: string | null;
  demoMode: boolean;
  productionSalesEnabled?: boolean;
  deliveryFeePaise: number;
  freeDeliveryThresholdPaise: number;
  minimumOrderPaise: number;
  deliveryRadiusKm: number;
}

export interface ServiceablePincodeDTO {
  id: string;
  pincode: string;
  areaName: string;
  deliveryFeePaise: number;
  estimatedMins: number;
  isActive: boolean;
}

export interface PromotionBannerDTO {
  id: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaLink: string;
  badgeText: string | null;
  imageUrl?: string | null;
  displayOrder: number;
  isActive: boolean;
  isDemoData: boolean;
}

export interface AuthUserDTO {
  id: string;
  businessId: string;
  storeId: string;
  email: string;
  phone: string | null;
  fullName: string;
  isEmailVerified: boolean;
  roles: Role[];
  createdAt: string;
}

export interface CategoryDTO {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  iconName?: string | null;
  bannerUrl?: string | null;
  seoDescription?: string | null;
  isFeatured?: boolean;
  isActive?: boolean;
  displayOrder: number;
  medicineCount?: number;
  subcategories?: Array<{
    id: string;
    name: string;
    slug: string;
    isActive?: boolean;
  }>;
}

export interface MedicineImageDTO {
  id: string;
  imageUrl: string;
  altText: string;
  isPrimary: boolean;
  sortOrder: number;
}

export interface MedicineDTO {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  slug: string;
  genericName: string;
  brand: string | null;
  strength: string | null;
  composition: string;
  dosageForm: string;
  packSize: string;
  scheduleType: string;
  requiresPrescription: boolean;
  mrpPaise: number;
  salePricePaise: number;
  gstPercent: number;
  hsnCode: string | null;
  storageInstructions: string | null;
  usageSummary: string | null;
  sideEffectsSummary: string | null;
  safetyAdvice: string | null;
  isActive: boolean;
  publicationStatus?: PublicationStatus;
  isDemoData: boolean;
  isFeatured: boolean;
  isEssential: boolean;
  isPharmacistApproved: boolean;
  isRecalled: boolean;
  onlineSaleRestricted: boolean;
  canPurchase: boolean;
  unavailableReason: string | null;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  subcategoryName: string | null;
  subcategorySlug: string | null;
  manufacturerName: string;
  imageUrl: string;
  images?: MedicineImageDTO[];
  availableStock: number;
  nearestExpiry: string | null;
}

export interface CartItemDTO {
  id: string;
  medicineId: string;
  slug: string;
  name: string;
  genericName: string;
  manufacturerName: string;
  strength: string | null;
  packSize: string;
  requiresPrescription: boolean;
  mrpPaise: number;
  salePricePaise: number;
  gstPercent: number;
  quantity: number;
  availableStock: number;
  canPurchase: boolean;
  imageUrl: string;
  isDemoData: boolean;
}

export interface CartDTO {
  id: string;
  items: CartItemDTO[];
  savedForLater: MedicineDTO[];
  subtotalPaise: number;
  mrpTotalPaise: number;
  savingsPaise: number;
  requiresPrescription: boolean;
}

export interface DriverLocationDTO {
  latitude: number;
  longitude: number;
  heading: number | null;
  speedKmh: number | null;
  accuracyM?: number | null;
  recordedAt: string;
}

export interface LegalPolicyDTO {
  id: string;
  slug: string;
  title: string;
  content: string;
  updatedAt: string;
}

export function formatINRPaise(paise: number): string {
  const rupees = (paise || 0) / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

export function formatIndianDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
