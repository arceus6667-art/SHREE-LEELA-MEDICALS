import { apiFetch } from '../lib/api.ts';

export type GpsTrackingStatus =
  | 'IDLE'
  | 'REQUESTING_PERMISSION'
  | 'TRACKING'
  | 'PERMISSION_DENIED'
  | 'GPS_DISABLED'
  | 'POOR_ACCURACY'
  | 'OFFLINE'
  | 'PAUSED'
  | 'BACKGROUNDED'
  | 'PERMISSION_REVOKED';

export interface TrackingTelemetrySnapshot {
  status: GpsTrackingStatus;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  speedKmh: number | null;
  heading: number | null;
  lastSentAt: string | null;
  errorMessage: string | null;
  isSuspiciousFlagged: boolean;
  isBatterySaverAdaptive: boolean;
}

export interface TrackingSessionConfig {
  activeAssignmentOrderId: string;
  onTelemetry: (snapshot: TrackingTelemetrySnapshot) => void;
}

/**
 * Modular tracking transport interface designed to work seamlessly with both:
 * 1) BrowserGeolocationTracker (PWA navigator.geolocation.watchPosition)
 * 2) Native Capacitor/Android Foreground Location Service bridge (see docs/NATIVE_ANDROID_TRACKING.md)
 */
export interface ITrackingTransport {
  readonly mode: 'BROWSER_PWA' | 'NATIVE_FOREGROUND_SERVICE';
  start(config: TrackingSessionConfig): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): Promise<void>;
  getSnapshot(): TrackingTelemetrySnapshot;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class BrowserGeolocationTracker implements ITrackingTransport {
  readonly mode = 'BROWSER_PWA' as const;
  private watchId: number | null = null;
  private config: TrackingSessionConfig | null = null;
  private lastTransmitMs = 0;
  private lastLat: number | null = null;
  private lastLng: number | null = null;
  private permissionStatus: PermissionStatus | null = null;
  private isPaused = false;
  private batteryAdaptive = false;

  private snapshot: TrackingTelemetrySnapshot = {
    status: 'IDLE',
    latitude: null,
    longitude: null,
    accuracyM: null,
    speedKmh: null,
    heading: null,
    lastSentAt: null,
    errorMessage: null,
    isSuspiciousFlagged: false,
    isBatterySaverAdaptive: false,
  };

  private emit(partial: Partial<TrackingTelemetrySnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    this.config?.onTelemetry(this.snapshot);
  }

  private handleVisibilityChange = () => {
    if (!this.config || this.isPaused) return;
    if (document.hidden) {
      this.emit({
        status: 'BACKGROUNDED',
        errorMessage: 'Browser tab backgrounded or screen locked. Web PWA GPS updates may pause until reopened.',
      });
    } else if (navigator.onLine && this.watchId !== null) {
      this.emit({
        status: 'TRACKING',
        errorMessage: null,
      });
    }
  };

  private handleOnline = () => {
    if (!this.config || this.isPaused) return;
    if (this.watchId !== null) {
      this.emit({ status: document.hidden ? 'BACKGROUNDED' : 'TRACKING', errorMessage: null });
    }
  };

  private handleOffline = () => {
    if (!this.config) return;
    this.emit({
      status: 'OFFLINE',
      errorMessage: 'Internet connection lost. Coordinates will resume when back online (no simulated pings).',
    });
  };

  getSnapshot(): TrackingTelemetrySnapshot {
    return this.snapshot;
  }

  async start(config: TrackingSessionConfig): Promise<void> {
    this.stop();
    this.config = config;
    this.isPaused = false;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.emit({
        status: 'GPS_DISABLED',
        errorMessage: 'Geolocation API is not available on this device/browser.',
      });
      return;
    }

    this.emit({ status: 'REQUESTING_PERMISSION', errorMessage: null });

    // Optional battery-saver adaptive throttle
    try {
      const navWithBattery = navigator as unknown as {
        getBattery?: () => Promise<{ level: number; charging: boolean }>;
      };
      if (navWithBattery.getBattery) {
        const battery = await navWithBattery.getBattery();
        this.batteryAdaptive = !battery.charging && battery.level < 0.25;
      }
    } catch {
      this.batteryAdaptive = false;
    }

    // Monitor live permission revocation
    try {
      if (navigator.permissions?.query) {
        this.permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
        this.permissionStatus.onchange = () => {
          if (this.permissionStatus?.state === 'denied') {
            this.stopWatchOnly();
            this.emit({
              status: 'PERMISSION_REVOKED',
              errorMessage: 'Location permission was revoked in browser settings. Re-enable permission to continue.',
            });
          }
        };
        if (this.permissionStatus.state === 'denied') {
          this.emit({
            status: 'PERMISSION_DENIED',
            errorMessage: 'Location permission is blocked. Enable GPS access in browser settings and retry.',
          });
          return;
        }
      }
    } catch {
      // Permissions API optional on Safari
    }

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    this.beginWatch();
  }

  private beginWatch() {
    if (!navigator.geolocation || !this.config) return;
    this.watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        if (this.isPaused || !this.config) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracyM = pos.coords.accuracy ?? null;
        const speedKmh = pos.coords.speed !== null && pos.coords.speed >= 0 ? Math.round(pos.coords.speed * 3.6) : null;
        const heading = pos.coords.heading !== null && !Number.isNaN(pos.coords.heading) ? pos.coords.heading : null;

        if (!navigator.onLine) {
          this.emit({
            status: 'OFFLINE',
            latitude: lat,
            longitude: lng,
            accuracyM,
            speedKmh,
            heading,
            errorMessage: 'Internet connection lost — waiting to transmit live GPS.',
          });
          return;
        }

        const isPoorAccuracy = accuracyM !== null && accuracyM > 120;
        const now = Date.now();
        const movedMeters =
          this.lastLat !== null && this.lastLng !== null ? haversineMeters(this.lastLat, this.lastLng, lat, lng) : 999;

        // Adaptive throttle: 5-10s normally, 10-15s on low battery or minimal movement
        const minIntervalMs = this.batteryAdaptive ? 10000 : 5000;
        const maxKeepaliveMs = this.batteryAdaptive ? 15000 : 10000;
        const shouldSend =
          this.lastTransmitMs === 0 ||
          (now - this.lastTransmitMs >= minIntervalMs && movedMeters >= 8) ||
          now - this.lastTransmitMs >= maxKeepaliveMs;

        this.emit({
          status: document.hidden ? 'BACKGROUNDED' : isPoorAccuracy ? 'POOR_ACCURACY' : 'TRACKING',
          latitude: lat,
          longitude: lng,
          accuracyM,
          speedKmh,
          heading,
          isBatterySaverAdaptive: this.batteryAdaptive,
          errorMessage: isPoorAccuracy
            ? `Poor GPS accuracy (±${Math.round(accuracyM)}m). Move outdoors for stronger signal.`
            : document.hidden
              ? 'Browser tab backgrounded; keep screen awake during transit.'
              : null,
        });

        if (!shouldSend) return;
        this.lastTransmitMs = now;
        this.lastLat = lat;
        this.lastLng = lng;

        try {
          const resp = await apiFetch<{ recordedAt: string; isSuspicious?: boolean }>('/api/delivery/location', {
            method: 'POST',
            body: JSON.stringify({
              orderId: this.config.activeAssignmentOrderId,
              latitude: lat,
              longitude: lng,
              heading,
              speedKmh,
              accuracyM,
              deviceTimestamp: new Date(pos.timestamp || now).toISOString(),
            }),
          });
          this.emit({
            lastSentAt: resp.recordedAt,
            isSuspiciousFlagged: Boolean(resp.isSuspicious),
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unable to send GPS update';
          this.emit({
            status: navigator.onLine ? 'PAUSED' : 'OFFLINE',
            errorMessage: msg,
          });
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          this.emit({
            status: 'PERMISSION_DENIED',
            errorMessage: 'GPS permission denied by device/browser. Authorize location access to stream live tracking.',
          });
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          this.emit({
            status: 'GPS_DISABLED',
            errorMessage: 'Device location services appear disabled or GPS fix unavailable.',
          });
        } else {
          this.emit({
            status: 'GPS_DISABLED',
            errorMessage: 'Timed out acquiring GPS lock. Ensure location services are active and retry.',
          });
        }
      },
      {
        enableHighAccuracy: !this.batteryAdaptive,
        maximumAge: 4000,
        timeout: 12000,
      }
    );
  }

  pause(): void {
    this.isPaused = true;
    this.stopWatchOnly();
    this.emit({
      status: 'PAUSED',
      errorMessage: 'Location updates manually paused by rider.',
    });
  }

  async resume(): Promise<void> {
    if (!this.config) return;
    await this.start(this.config);
  }

  private stopWatchOnly(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  stop(): void {
    this.stopWatchOnly();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    if (this.permissionStatus) {
      this.permissionStatus.onchange = null;
      this.permissionStatus = null;
    }
    this.config = null;
    this.lastTransmitMs = 0;
    this.lastLat = null;
    this.lastLng = null;
    this.isPaused = false;
    this.snapshot = {
      status: 'IDLE',
      latitude: null,
      longitude: null,
      accuracyM: null,
      speedKmh: null,
      heading: null,
      lastSentAt: null,
      errorMessage: null,
      isSuspiciousFlagged: false,
      isBatterySaverAdaptive: false,
    };
  }
}

export const deliveryTracker = new BrowserGeolocationTracker();

// =========================================================================
// OFFLINE ASSIGNMENT CACHE & IDEMPOTENT STATUS QUEUE
// Security rule: NEVER cache prescription images, Rx text, or medical history!
// =========================================================================
const ASSIGNMENT_CACHE_KEY = 'slm_delivery_cached_assignment_v1';
const OFFLINE_QUEUE_KEY = 'slm_delivery_offline_queue_v1';

export interface CachedAssignmentEssentials {
  orderId: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerPhone: string;
  addressSummary: string;
  paymentMethod: string;
  paymentStatus: string;
  totalPaise: number;
  deliveryNotes: string | null;
  cachedAt: string;
}

export interface OfflineQueuedStatusEvent {
  clientEventId: string;
  orderId: string;
  orderNumber: string;
  status: string;
  proofNote?: string;
  reason?: string;
  queuedAt: string;
}

export function cacheEssentialAssignment(item: CachedAssignmentEssentials): void {
  try {
    localStorage.setItem(ASSIGNMENT_CACHE_KEY, JSON.stringify(item));
  } catch {
    // Ignore storage quota issues
  }
}

export function getCachedEssentialAssignment(): CachedAssignmentEssentials | null {
  try {
    const raw = localStorage.getItem(ASSIGNMENT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedAssignmentEssentials) : null;
  } catch {
    return null;
  }
}

export function clearCachedEssentialAssignment(): void {
  try {
    localStorage.removeItem(ASSIGNMENT_CACHE_KEY);
  } catch {
    // Ignore
  }
}

export function getOfflineQueue(): OfflineQueuedStatusEvent[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineQueuedStatusEvent[]) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineStatusUpdate(event: Omit<OfflineQueuedStatusEvent, 'clientEventId' | 'queuedAt'>): OfflineQueuedStatusEvent {
  const queue = getOfflineQueue();
  const item: OfflineQueuedStatusEvent = {
    ...event,
    clientEventId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    queuedAt: new Date().toISOString(),
  };
  queue.push(item);
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore
  }
  return item;
}

export async function flushOfflineQueue(): Promise<{ syncedCount: number; remaining: OfflineQueuedStatusEvent[] }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { syncedCount: 0, remaining: [] };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { syncedCount: 0, remaining: queue };
  }

  try {
    const resp = await apiFetch<{
      synced: Array<{ clientEventId: string; statusCode: number; ok: boolean }>;
    }>('/api/delivery/offline-sync', {
      method: 'POST',
      body: JSON.stringify({
        events: queue.map((q) => ({
          clientEventId: q.clientEventId,
          orderId: q.orderId,
          status: q.status,
          proofNote: q.proofNote,
          reason: q.reason,
        })),
      }),
    });

    const settledIds = new Set(
      resp.synced.filter((r) => r.ok || r.statusCode === 400 || r.statusCode === 404 || r.statusCode === 409).map((r) => r.clientEventId)
    );
    const remaining = queue.filter((q) => !settledIds.has(q.clientEventId));
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    return { syncedCount: queue.length - remaining.length, remaining };
  } catch {
    return { syncedCount: 0, remaining: queue };
  }
}
