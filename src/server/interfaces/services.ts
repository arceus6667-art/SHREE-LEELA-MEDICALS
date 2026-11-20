import type { OrderStatus, PaymentMethod, RazorpayOrderInitDTO, Role } from '../../shared/types.ts';

export interface SessionPayload {
  sessionId: string;
  userId: string;
  businessId: string;
  storeId: string;
  roles: Role[];
  expiresAt: string;
}

export interface IAuthService {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, hash: string): Promise<boolean>;
  createSession(userId: string, rememberMe: boolean, userAgent?: string): Promise<{ token: string; expiresAt: Date }>;
  validateSessionToken(token: string): Promise<SessionPayload | null>;
  revokeSession(token: string): Promise<void>;
  createEmailVerificationToken(userId: string): Promise<string>;
  verifyEmailToken(token: string): Promise<{ userId: string } | null>;
  createPasswordResetToken(email: string): Promise<string | null>;
  resetPasswordWithToken(token: string, newPassword: string): Promise<boolean>;
}

export interface IStorageService {
  saveFile(params: {
    folder: 'prescriptions' | 'store' | 'medicines' | 'partners' | 'invoices' | 'pod';
    originalName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<{ fileKey: string; publicUrl: string }>;
  getAbsolutePath(fileKey: string): string | null;
}

export interface IMalwareScannerService {
  scanBuffer(params: {
    buffer: Buffer;
    declaredMime: string;
    originalName: string;
  }): Promise<{ clean: boolean; detectedMime: string | null; reason?: string }>;
}

export interface RouteComputeResult {
  available: boolean;
  distanceKm: number;
  etaMinutes: number | null;
  encodedPolyline: string | null;
  reason?: string;
}

export interface GeocodeResult {
  available: boolean;
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  postalCode?: string;
  reason?: string;
}

export interface PlaceSuggestion {
  placeId: string;
  description: string;
  primaryText: string;
  secondaryText?: string;
}

export interface IRealtimeService {
  emitEvent(params: {
    event: string;
    orderId?: string | null;
    storeId?: string | null;
    partnerId?: string | null;
    userId?: string | null;
    payload: Record<string, unknown>;
  }): void;
  emitOrderUpdate(orderId: string, storeId: string, payload: Record<string, unknown>, partnerId?: string | null): void;
  emitDriverLocation(orderId: string | null, storeId: string, payload: {
    deliveryPartnerId: string;
    orderId: string | null;
    latitude: number;
    longitude: number;
    heading: number | null;
    speedKmh: number | null;
    accuracyM?: number | null;
    isSuspicious?: boolean;
    recordedAt: string;
  }): void;
  emitPrescriptionReview(storeId: string, userId: string, payload: Record<string, unknown>): void;
}

export interface IMapsAdapter {
  isConfigured(): boolean;
  computeDistanceKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number;
  estimateEtaMinutes(distanceKm: number): number | null;
  computeRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteComputeResult>;
  geocodeAddress(address: string): Promise<GeocodeResult>;
  autocompletePlaces(input: string, sessionToken?: string): Promise<{ available: boolean; suggestions: PlaceSuggestion[]; reason?: string }>;
  getPlaceDetails(placeId: string, sessionToken?: string): Promise<GeocodeResult>;
  getGoogleMapsPlaceUrl(storeName: string, lat: number, lng: number, configuredUrl?: string | null): string;
  getDirectionsUrl(fromLat: number, fromLng: number, toLat: number, toLng: number): string;
}

export interface IDatabaseService {
  withTransaction<T>(fn: () => T): T;
}

export type NotificationTemplateKey =
  | 'ACCOUNT_REGISTERED'
  | 'ORDER_RECEIVED'
  | 'PRESCRIPTION_CLARIFICATION'
  | 'PRESCRIPTION_DECISION'
  | 'QUOTATION_READY'
  | 'PAYMENT_RECEIVED'
  | 'ORDER_CONFIRMED'
  | 'DRIVER_ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_OTP'
  | 'ORDER_CANCELLED'
  | 'REFUND_STATUS'
  | 'LOW_INVENTORY_ALERT';

export interface INotificationService {
  notify(params: {
    userId: string;
    orderId?: string | null;
    template: NotificationTemplateKey;
    variables: Record<string, string | number | null | undefined>;
  }): Promise<void>;
}

export interface IPaymentGatewayService {
  isLiveModeAllowed(storeId: string): { allowed: boolean; reason?: string };
  createGatewayOrder(params: {
    storeId: string;
    userId: string;
    orderId?: string;
    amountPaise: number;
    method: PaymentMethod;
    receipt: string;
  }): Promise<RazorpayOrderInitDTO>;
  verifySignature(params: {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
  }): boolean;
  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean;
  generateTestSignature(gatewayOrderId: string, gatewayPaymentId: string): string;
}

export interface IOrderLifecycleService {
  transition(params: {
    orderId: string;
    storeId: string;
    nextStatus: OrderStatus;
    actorUserId: string;
    actorRoles?: Role[];
    reason?: string;
    note?: string;
    bypassGuard?: boolean;
  }): { previousStatus: OrderStatus; newStatus: OrderStatus };
}
