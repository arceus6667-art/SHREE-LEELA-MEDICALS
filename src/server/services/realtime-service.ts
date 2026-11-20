import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { sqlite } from '../db/sqlite-db.ts';
import { authService, SESSION_COOKIE_NAME } from './auth-service.ts';
import type { IRealtimeService } from '../interfaces/services.ts';
import { Role } from '../../shared/types.ts';

function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      result[k] = v;
    }
  }
  return result;
}

const STAFF_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.STORE_ADMIN,
  Role.PHARMACIST,
  Role.INVENTORY_MANAGER,
];

export const GPS_FRESHNESS_THRESHOLD_SECONDS = 60;

export class SocketIoRealtimeService implements IRealtimeService {
  private io: SocketIOServer | null = null;
  private eventSeq = 1;
  private staleTracker = new Map<string, number>();
  private staleInterval: ReturnType<typeof setInterval> | null = null;

  private nextEnvelope(event: string, payload: Record<string, unknown>) {
    return {
      seq: this.eventSeq++,
      event,
      timestamp: new Date().toISOString(),
      ...payload,
    };
  }

  private canAccessOrder(
    auth: { userId: string; storeId: string; roles: string[] } | undefined,
    orderId: string
  ): boolean {
    if (!auth) return false;

    const order = sqlite
      .prepare('SELECT id, user_id, store_id FROM orders WHERE id = ? OR upper(order_number) = upper(?)')
      .get(orderId, orderId) as { id: string; user_id: string; store_id: string } | undefined;

    if (!order) return false;
    if (order.user_id === auth.userId) return true;

    const isStaff = auth.roles.some((r) => STAFF_ROLES.includes(r as Role));
    if (isStaff && order.store_id === auth.storeId) return true;

    if (auth.roles.includes(Role.DELIVERY_PARTNER)) {
      const assigned = sqlite
        .prepare(
          `SELECT da.id
           FROM delivery_assignments da
           JOIN delivery_partners dp ON dp.id = da.delivery_partner_id
           WHERE da.order_id = ? AND dp.user_id = ?
             AND da.status NOT IN ('ASSIGNMENT_REJECTED', 'CANCELLED')`
        )
        .get(order.id, auth.userId);
      if (assigned) return true;
    }

    return false;
  }

  attach(httpServer: HttpServer): SocketIOServer {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: true,
        credentials: true,
      },
      path: '/socket.io',
    });

    this.io.use(async (socket, next) => {
      try {
        const rawCookie = socket.handshake.headers.cookie || '';
        const parsed = parseCookies(rawCookie);
        const token = parsed[SESSION_COOKIE_NAME];
        if (token) {
          const session = await authService.validateSessionToken(token);
          if (session) {
            socket.data.auth = session;
          }
        }
        next();
      } catch {
        next();
      }
    });

    this.io.on('connection', (socket) => {
      const auth = socket.data.auth as
        | { userId: string; storeId: string; roles: string[] }
        | undefined;

      if (auth) {
        socket.join(`user:${auth.userId}`);
        const isStaff = auth.roles.some((r) => STAFF_ROLES.includes(r as Role));
        if (isStaff && auth.storeId) {
          socket.join(`store:${auth.storeId}:admin`);
        }
        if (auth.roles.includes(Role.DELIVERY_PARTNER)) {
          const dp = sqlite
            .prepare('SELECT id FROM delivery_partners WHERE user_id = ?')
            .get(auth.userId) as { id: string } | undefined;
          if (dp) {
            socket.data.partnerId = dp.id;
            socket.join(`partner:${dp.id}`);
          }
        }
      }

      socket.on('join:order', (orderId: string, ack?: (resp: { ok: boolean; error?: string }) => void) => {
        if (typeof orderId !== 'string' || orderId.length < 4) {
          ack?.({ ok: false, error: 'Invalid order identifier' });
          return;
        }
        if (!this.canAccessOrder(auth, orderId)) {
          socket.emit('room:error', {
            orderId,
            error: 'Unauthorized: sign in as the order owner, assigned delivery partner, or store administrator.',
          });
          ack?.({ ok: false, error: 'Unauthorized room subscription' });
          return;
        }

        const order = sqlite
          .prepare('SELECT id FROM orders WHERE id = ? OR upper(order_number) = upper(?)')
          .get(orderId, orderId) as { id: string } | undefined;
        if (order) {
          socket.join(`order:${order.id}`);
          ack?.({ ok: true });
        } else {
          ack?.({ ok: false, error: 'Order not found' });
        }
      });

      socket.on('leave:order', (orderId: string) => {
        if (typeof orderId === 'string') {
          socket.leave(`order:${orderId}`);
        }
      });
    });

    if (!this.staleInterval) {
      this.staleInterval = setInterval(() => {
        this.checkStaleLocations();
      }, 30000);
      this.staleInterval.unref?.();
    }

    return this.io;
  }

  private checkStaleLocations(): void {
    if (!this.io) return;
    try {
      const active = sqlite
        .prepare(
          `SELECT da.id as assignment_id, da.order_id, da.store_id, da.delivery_partner_id, da.status,
                  dp.last_location_at, dp.current_lat, dp.current_lng
           FROM delivery_assignments da
           JOIN delivery_partners dp ON dp.id = da.delivery_partner_id
           WHERE da.status IN ('PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED_AT_CUSTOMER')`
        )
        .all() as Array<{
        assignment_id: string;
        order_id: string;
        store_id: string;
        delivery_partner_id: string;
        status: string;
        last_location_at: string | null;
        current_lat: number | null;
        current_lng: number | null;
      }>;

      const now = Date.now();
      for (const row of active) {
        const lastMs = row.last_location_at ? new Date(row.last_location_at).getTime() : 0;
        const ageSec = lastMs ? Math.floor((now - lastMs) / 1000) : 9999;
        if (ageSec > GPS_FRESHNESS_THRESHOLD_SECONDS) {
          const lastNotified = this.staleTracker.get(row.assignment_id) || 0;
          if (now - lastNotified > 60000) {
            this.staleTracker.set(row.assignment_id, now);
            this.emitEvent({
              event: 'delivery.location.stale',
              orderId: row.order_id,
              storeId: row.store_id,
              payload: {
                orderId: row.order_id,
                deliveryPartnerId: row.delivery_partner_id,
                lastLocationAt: row.last_location_at,
                staleSeconds: ageSec,
              },
            });
          }
        } else {
          this.staleTracker.delete(row.assignment_id);
        }
      }
    } catch {
      // Ignore transient shutdown/query errors
    }
  }

  emitEvent(params: {
    event: string;
    orderId?: string | null;
    storeId?: string | null;
    partnerId?: string | null;
    userId?: string | null;
    payload: Record<string, unknown>;
  }): void {
    if (!this.io) return;
    const envelope = this.nextEnvelope(params.event, params.payload);
    if (params.orderId) {
      this.io.to(`order:${params.orderId}`).emit(params.event, envelope);
    }
    if (params.storeId) {
      this.io.to(`store:${params.storeId}:admin`).emit(params.event, envelope);
    }
    if (params.partnerId) {
      this.io.to(`partner:${params.partnerId}`).emit(params.event, envelope);
    }
    if (params.userId) {
      this.io.to(`user:${params.userId}`).emit(params.event, envelope);
    }
  }

  emitOrderUpdate(
    orderId: string,
    storeId: string,
    payload: Record<string, unknown>,
    partnerId?: string | null
  ): void {
    if (!this.io) return;
    const envelope = this.nextEnvelope('order.status.updated', payload);
    this.io.to(`order:${orderId}`).emit('order:updated', envelope);
    this.io.to(`store:${storeId}:admin`).emit('order:updated', envelope);
    this.io.to(`order:${orderId}`).emit('order.status.updated', envelope);
    this.io.to(`store:${storeId}:admin`).emit('order.status.updated', envelope);
    if (partnerId) {
      this.io.to(`partner:${partnerId}`).emit('order:updated', envelope);
      this.io.to(`partner:${partnerId}`).emit('order.status.updated', envelope);
    }
  }

  emitDriverLocation(
    orderId: string | null,
    storeId: string,
    payload: {
      deliveryPartnerId: string;
      orderId: string | null;
      latitude: number;
      longitude: number;
      heading: number | null;
      speedKmh: number | null;
      accuracyM?: number | null;
      isSuspicious?: boolean;
      recordedAt: string;
    }
  ): void {
    if (!this.io) return;
    const envelope = this.nextEnvelope('delivery.location.updated', payload);
    if (orderId) {
      this.io.to(`order:${orderId}`).emit('driver:location', envelope);
      this.io.to(`order:${orderId}`).emit('delivery.location.updated', envelope);
    }
    this.io.to(`store:${storeId}:admin`).emit('driver:location', envelope);
    this.io.to(`store:${storeId}:admin`).emit('delivery.location.updated', envelope);
  }

  emitPrescriptionReview(storeId: string, userId: string, payload: Record<string, unknown>): void {
    if (!this.io) return;
    const envelope = this.nextEnvelope('prescription.reviewed', payload);
    this.io.to(`store:${storeId}:admin`).emit('prescription:updated', envelope);
    this.io.to(`user:${userId}`).emit('prescription:updated', envelope);
    this.io.to(`store:${storeId}:admin`).emit('prescription.reviewed', envelope);
    this.io.to(`user:${userId}`).emit('prescription.reviewed', envelope);
  }
}

export const realtimeService = new SocketIoRealtimeService();
