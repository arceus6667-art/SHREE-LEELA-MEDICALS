import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { sqlite, databaseService } from '../db/sqlite-db.ts';
import { requireRoles, type AuthenticatedRequest } from '../services/auth-service.ts';
import { realtimeService } from '../services/realtime-service.ts';
import { storageService } from '../services/storage-service.ts';
import { mapsAdapter } from '../services/maps-adapter.ts';
import { notificationService } from '../services/notification-service.ts';
import { createSignedFileUrl, malwareScannerService } from '../services/security-service.ts';
import { getPublicStoreInfo } from './public-customer.ts';
import {
  ALLOWED_DELIVERY_TRANSITIONS,
  DeliveryAssignmentStatus,
  OrderStatus,
  PaymentStatus,
  Role,
  TRACKABLE_ASSIGNMENT_STATUSES,
} from '../../shared/types.ts';

const podUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const TERMINAL_LIST_SQL = "('DELIVERED', 'ASSIGNMENT_REJECTED', 'RETURNED', 'CANCELLED', 'FAILED')";
const MAX_OTP_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 15 * 60 * 1000;
const LOCATION_RETENTION_DAYS = 30;
let lastRetentionCleanupMs = 0;

function maybePruneOldLocations(): void {
  const now = Date.now();
  if (now - lastRetentionCleanupMs < 10 * 60 * 1000) return;
  lastRetentionCleanupMs = now;
  try {
    sqlite
      .prepare(`DELETE FROM driver_locations WHERE recorded_at < datetime('now', '-' || ? || ' days')`)
      .run(LOCATION_RETENTION_DAYS);
  } catch {
    // Non-fatal maintenance
  }
}

export function createDeliveryRouter(): Router {
  const router = Router();
  router.use(requireRoles([Role.DELIVERY_PARTNER, Role.STORE_ADMIN, Role.SUPER_ADMIN]));

  function getPartnerForRequest(req: AuthenticatedRequest) {
    let partner = sqlite
      .prepare(
        `SELECT dp.*, u.full_name, u.phone, u.email
         FROM delivery_partners dp
         JOIN users u ON u.id = dp.user_id
         WHERE dp.user_id = ?`
      )
      .get(req.auth!.userId) as Record<string, unknown> | undefined;

    if (!partner && (req.auth!.roles.includes(Role.STORE_ADMIN) || req.auth!.roles.includes(Role.SUPER_ADMIN))) {
      partner = sqlite
        .prepare(
          `SELECT dp.*, u.full_name, u.phone, u.email
           FROM delivery_partners dp
           JOIN users u ON u.id = dp.user_id
           WHERE dp.store_id = ? LIMIT 1`
        )
        .get(req.auth!.storeId) as Record<string, unknown> | undefined;
    }
    return partner;
  }

  function applyAssignmentStatusTransition(params: {
    partner: Record<string, unknown>;
    orderIdParam: string;
    nextStatus: DeliveryAssignmentStatus;
    proofNote?: string;
    reason?: string;
    otp?: string;
    signatureDataUrl?: string;
    podPhotoUrl?: string;
    cashCollectedPaise?: number;
    clientEventId?: string;
    actorUserId: string;
  }): { statusCode: number; body: Record<string, unknown> } {
    const {
      partner,
      orderIdParam,
      nextStatus,
      proofNote,
      reason,
      otp,
      signatureDataUrl,
      podPhotoUrl,
      cashCollectedPaise,
      clientEventId,
      actorUserId,
    } = params;

    if (clientEventId) {
      const existingEvent = sqlite
        .prepare('SELECT response_json FROM delivery_offline_events WHERE idempotency_key = ?')
        .get(clientEventId) as { response_json: string | null } | undefined;
      if (existingEvent) {
        return {
          statusCode: 200,
          body: {
            ok: true,
            idempotentReplay: true,
            ...(existingEvent.response_json ? JSON.parse(existingEvent.response_json) : {}),
          },
        };
      }
    }

    const row = sqlite
      .prepare(
        `SELECT da.id as assignment_id, da.order_id, da.store_id, da.status as current_status,
                da.delivery_partner_id, da.cash_collected_paise,
                o.order_number, o.user_id as customer_user_id, o.total_paise, o.payment_method, o.payment_status,
                o.delivery_otp, o.delivery_otp_expires_at, o.delivery_otp_attempts, o.delivery_otp_locked_until
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         WHERE (da.order_id = ? OR da.id = ?) AND da.delivery_partner_id = ?`
      )
      .get(orderIdParam, orderIdParam, partner.id as string) as
      | {
          assignment_id: string;
          order_id: string;
          store_id: string;
          current_status: string;
          delivery_partner_id: string;
          cash_collected_paise: number | null;
          order_number: string;
          customer_user_id: string;
          total_paise: number;
          payment_method: string;
          payment_status: string;
          delivery_otp: string | null;
          delivery_otp_expires_at: string | null;
          delivery_otp_attempts: number;
          delivery_otp_locked_until: string | null;
        }
      | undefined;

    if (!row) {
      return { statusCode: 404, body: { error: 'Delivery assignment not found for your account' } };
    }

    if (row.current_status === DeliveryAssignmentStatus.DELIVERED && nextStatus === DeliveryAssignmentStatus.DELIVERED) {
      return { statusCode: 409, body: { error: 'Delivery is already completed. Duplicate completion blocked.' } };
    }

    const allowedNext = ALLOWED_DELIVERY_TRANSITIONS[row.current_status] || [];
    if (!allowedNext.includes(nextStatus)) {
      return {
        statusCode: 400,
        body: {
          error: `Invalid state transition from ${row.current_status} to ${nextStatus}. Allowed next states: ${
            allowedNext.length ? allowedNext.join(', ') : 'None (terminal state)'
          }`,
        },
      };
    }

    const reasonText = (reason || proofNote || '').trim();
    if (
      (nextStatus === DeliveryAssignmentStatus.ASSIGNMENT_REJECTED ||
        nextStatus === DeliveryAssignmentStatus.DELIVERY_FAILED ||
        nextStatus === DeliveryAssignmentStatus.RETURNING_TO_STORE ||
        nextStatus === DeliveryAssignmentStatus.RETURNED) &&
      reasonText.length < 3
    ) {
      return {
        statusCode: 400,
        body: { error: `A detailed reason (min 3 characters) is required for ${nextStatus}.` },
      };
    }

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();

    // Proof of Delivery OTP + attempt limits + lockout validation
    if (nextStatus === DeliveryAssignmentStatus.DELIVERED) {
      if (row.delivery_otp) {
        if (row.delivery_otp_locked_until && new Date(row.delivery_otp_locked_until).getTime() > nowMs) {
          const waitMins = Math.ceil((new Date(row.delivery_otp_locked_until).getTime() - nowMs) / 60000);
          return {
            statusCode: 429,
            body: { error: `OTP verification locked after excessive failed attempts. Try again in ${waitMins} min(s).` },
          };
        }
        if (row.delivery_otp_expires_at && new Date(row.delivery_otp_expires_at).getTime() < nowMs) {
          return {
            statusCode: 400,
            body: { error: 'Customer delivery OTP has expired. Ask pharmacy admin to regenerate OTP or mark exception.' },
          };
        }
        const submittedOtp = (otp || '').trim();
        if (!submittedOtp) {
          return {
            statusCode: 400,
            body: { error: 'Customer 4-digit handover OTP is required to complete delivery.' },
          };
        }
        if (submittedOtp !== row.delivery_otp) {
          const nextAttempts = (row.delivery_otp_attempts || 0) + 1;
          const lockedUntil = nextAttempts >= MAX_OTP_ATTEMPTS ? new Date(nowMs + OTP_LOCKOUT_MS).toISOString() : null;
          sqlite
            .prepare('UPDATE orders SET delivery_otp_attempts = ?, delivery_otp_locked_until = ?, updated_at = ? WHERE id = ?')
            .run(nextAttempts, lockedUntil, now, row.order_id);
          return {
            statusCode: lockedUntil ? 429 : 400,
            body: {
              error: lockedUntil
                ? 'Maximum OTP attempts exceeded. Handover verification locked for 15 minutes.'
                : `Incorrect customer OTP (${MAX_OTP_ATTEMPTS - nextAttempts} attempts remaining).`,
            },
          };
        }
      }

      if (
        row.payment_method === 'CASH_ON_DELIVERY' &&
        row.payment_status === PaymentStatus.PAID &&
        row.cash_collected_paise !== null
      ) {
        return {
          statusCode: 409,
          body: { error: 'COD payment has already been collected and recorded for this order.' },
        };
      }
    }

    const codCollectedNow =
      nextStatus === DeliveryAssignmentStatus.DELIVERED && row.payment_method === 'CASH_ON_DELIVERY'
        ? cashCollectedPaise ?? row.total_paise
        : null;

    databaseService.withTransaction(() => {
      const acceptedAt = nextStatus === DeliveryAssignmentStatus.ACCEPTED ? now : null;
      const arrivedStoreAt = nextStatus === DeliveryAssignmentStatus.ARRIVED_AT_STORE ? now : null;
      const pickedUpAt = nextStatus === DeliveryAssignmentStatus.PICKED_UP ? now : null;
      const arrivedCustAt = nextStatus === DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER ? now : null;
      const deliveredAt = nextStatus === DeliveryAssignmentStatus.DELIVERED ? now : null;
      const returnedAt = nextStatus === DeliveryAssignmentStatus.RETURNED ? now : null;

      sqlite
        .prepare(
          `UPDATE delivery_assignments
           SET status = ?,
               accepted_at = COALESCE(accepted_at, ?),
               arrived_at_store_at = COALESCE(arrived_at_store_at, ?),
               picked_up_at = COALESCE(picked_up_at, ?),
               arrived_at_customer_at = COALESCE(arrived_at_customer_at, ?),
               delivered_at = COALESCE(delivered_at, ?),
               returned_at = COALESCE(returned_at, ?),
               rejection_reason = CASE WHEN ? = 'ASSIGNMENT_REJECTED' THEN ? ELSE rejection_reason END,
               failure_reason = CASE WHEN ? IN ('DELIVERY_FAILED', 'RETURNING_TO_STORE', 'RETURNED') THEN ? ELSE failure_reason END,
               proof_note = COALESCE(?, proof_note),
               signature_data_url = COALESCE(?, signature_data_url),
               pod_photo_url = COALESCE(?, pod_photo_url),
               cash_collected_paise = COALESCE(cash_collected_paise, ?),
               last_event_seq = last_event_seq + 1,
               updated_at = ?
           WHERE id = ?`
        )
        .run(
          nextStatus,
          acceptedAt,
          arrivedStoreAt,
          pickedUpAt,
          arrivedCustAt,
          deliveredAt,
          returnedAt,
          nextStatus,
          reasonText || null,
          nextStatus,
          reasonText || null,
          proofNote || reasonText || null,
          signatureDataUrl || null,
          podPhotoUrl || null,
          codCollectedNow,
          now,
          row.assignment_id
        );

      const nextOrderStatus =
        nextStatus === DeliveryAssignmentStatus.PICKED_UP ||
        nextStatus === DeliveryAssignmentStatus.OUT_FOR_DELIVERY ||
        nextStatus === DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER
          ? OrderStatus.OUT_FOR_DELIVERY
          : nextStatus === DeliveryAssignmentStatus.DELIVERED
            ? OrderStatus.DELIVERED
            : nextStatus === DeliveryAssignmentStatus.DELIVERY_FAILED
              ? OrderStatus.DELIVERY_FAILED
              : nextStatus === DeliveryAssignmentStatus.RETURNED
                ? OrderStatus.RETURNED
                : nextStatus === DeliveryAssignmentStatus.CANCELLED
                  ? OrderStatus.CANCELLED
                  : nextStatus === DeliveryAssignmentStatus.ASSIGNMENT_REJECTED
                    ? OrderStatus.READY_FOR_DISPATCH
                    : OrderStatus.DRIVER_ASSIGNED;

      if (nextStatus === DeliveryAssignmentStatus.DELIVERED && row.payment_method === 'CASH_ON_DELIVERY') {
        sqlite
          .prepare('UPDATE orders SET status = ?, payment_status = ?, updated_at = ? WHERE id = ?')
          .run(nextOrderStatus, PaymentStatus.PAID, now, row.order_id);
        sqlite
          .prepare(
            "UPDATE payments SET status = ?, paid_at = COALESCE(paid_at, ?), provider_reference = COALESCE(provider_reference, ?), updated_at = ? WHERE order_id = ? AND status != 'PAID'"
          )
          .run(PaymentStatus.PAID, now, `COD_${row.order_number}`, now, row.order_id);
      } else {
        sqlite.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(nextOrderStatus, now, row.order_id);
      }

      sqlite
        .prepare('INSERT INTO order_status_history (id, order_id, status, note, changed_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(
          crypto.randomUUID(),
          row.order_id,
          nextOrderStatus,
          reasonText ? `${nextStatus}: ${reasonText}` : `Delivery update: ${nextStatus}`,
          actorUserId,
          now
        );

      if (clientEventId) {
        sqlite
          .prepare(
            'INSERT OR IGNORE INTO delivery_offline_events (idempotency_key, assignment_id, event_type, response_json, created_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run(clientEventId, row.assignment_id, nextStatus, JSON.stringify({ status: nextStatus, orderId: row.order_id }), now);
      }
    });

    if (
      nextStatus === DeliveryAssignmentStatus.OUT_FOR_DELIVERY ||
      nextStatus === DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER ||
      nextStatus === DeliveryAssignmentStatus.DELIVERED ||
      nextStatus === DeliveryAssignmentStatus.DELIVERY_FAILED
    ) {
      const tpl = nextStatus === DeliveryAssignmentStatus.DELIVERED ? 'ORDER_DELIVERED' : 'OUT_FOR_DELIVERY';
      notificationService.notify({
        userId: row.customer_user_id,
        storeId: row.store_id,
        template: tpl,
        title: `Order ${row.order_number} · ${nextStatus.replace(/_/g, ' ')}`,
        message:
          nextStatus === DeliveryAssignmentStatus.DELIVERED
            ? 'Your pharmacy order has been delivered safely.'
            : nextStatus === DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER
              ? 'Delivery partner has arrived at your doorstep.'
              : nextStatus === DeliveryAssignmentStatus.DELIVERY_FAILED
                ? `Delivery attempt failed: ${reasonText}`
                : 'Your order is out for delivery.',
        metadata: { orderId: row.order_id, deliveryStatus: nextStatus },
      });
    }

    const eventPayload = {
      orderId: row.order_id,
      orderNumber: row.order_number,
      status:
        nextStatus === DeliveryAssignmentStatus.DELIVERED
          ? OrderStatus.DELIVERED
          : nextStatus === DeliveryAssignmentStatus.DELIVERY_FAILED
            ? OrderStatus.DELIVERY_FAILED
            : nextStatus === DeliveryAssignmentStatus.RETURNED
              ? OrderStatus.RETURNED
              : nextStatus === DeliveryAssignmentStatus.PICKED_UP ||
                  nextStatus === DeliveryAssignmentStatus.OUT_FOR_DELIVERY ||
                  nextStatus === DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER
                ? OrderStatus.OUT_FOR_DELIVERY
                : undefined,
      deliveryStatus: nextStatus,
      deliveryPartnerId: row.delivery_partner_id,
    };

    realtimeService.emitOrderUpdate(row.order_id, row.store_id, eventPayload, row.delivery_partner_id);

    if (nextStatus === DeliveryAssignmentStatus.ACCEPTED) {
      realtimeService.emitEvent({
        event: 'delivery.accepted',
        orderId: row.order_id,
        storeId: row.store_id,
        partnerId: row.delivery_partner_id,
        payload: eventPayload,
      });
    } else if (nextStatus === DeliveryAssignmentStatus.DELIVERED) {
      realtimeService.emitEvent({
        event: 'delivery.completed',
        orderId: row.order_id,
        storeId: row.store_id,
        partnerId: row.delivery_partner_id,
        userId: row.customer_user_id,
        payload: {
          ...eventPayload,
          deliveredAt: now,
          cashCollectedPaise: codCollectedNow,
        },
      });
      if (codCollectedNow !== null) {
        realtimeService.emitEvent({
          event: 'payment.updated',
          orderId: row.order_id,
          storeId: row.store_id,
          payload: {
            orderId: row.order_id,
            paymentStatus: PaymentStatus.PAID,
            method: row.payment_method,
            amountPaise: codCollectedNow,
          },
        });
      }
    }

    return {
      statusCode: 200,
      body: { ok: true, deliveryStatus: nextStatus, orderId: row.order_id },
    };
  }

  router.get('/dashboard', (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Delivery partner profile not found' });
      return;
    }
    if (partner.account_status === 'SUSPENDED') {
      res.status(403).json({ error: 'Delivery partner account is suspended. Contact store administrator.' });
      return;
    }

    const activeCount = sqlite
      .prepare(`SELECT COUNT(*) as c FROM delivery_assignments WHERE delivery_partner_id = ? AND status NOT IN ${TERMINAL_LIST_SQL}`)
      .get(partner.id as string) as { c: number };

    const pendingCount = sqlite
      .prepare("SELECT COUNT(*) as c FROM delivery_assignments WHERE delivery_partner_id = ? AND status = 'ASSIGNED'")
      .get(partner.id as string) as { c: number };

    const completedToday = sqlite
      .prepare(
        `SELECT COUNT(*) as c
         FROM delivery_assignments
         WHERE delivery_partner_id = ? AND status = 'DELIVERED'
           AND date(delivered_at, '+5 hours', '+30 minutes') = date('now', '+5 hours', '+30 minutes')`
      )
      .get(partner.id as string) as { c: number };

    const completedTotal = sqlite
      .prepare("SELECT COUNT(*) as c FROM delivery_assignments WHERE delivery_partner_id = ? AND status = 'DELIVERED'")
      .get(partner.id as string) as { c: number };

    const pendingCod = sqlite
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(da.cash_collected_paise, o.total_paise)), 0) as total_paise,
                COUNT(o.id) as cod_orders
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         WHERE da.delivery_partner_id = ?
           AND da.status = 'DELIVERED'
           AND o.payment_method = 'CASH_ON_DELIVERY'
           AND COALESCE(o.cod_reconciled, 0) = 0`
      )
      .get(partner.id as string) as { total_paise: number; cod_orders: number };

    // Data minimization: select ONLY delivery operational fields (zero prescription/clinical data)
    const activeAssignments = sqlite
      .prepare(
        `SELECT da.id, da.order_id, da.status, da.priority, da.assigned_at, da.accepted_at,
                da.arrived_at_store_at, da.picked_up_at, da.arrived_at_customer_at,
                da.estimated_distance_km, da.pickup_time_target, da.failure_reason,
                o.order_number, o.total_paise, o.payment_method, o.payment_status, o.delivery_notes,
                u.full_name as customer_name, u.phone as customer_phone,
                a.line1, a.line2, a.landmark, a.city, a.postal_code, a.latitude as dest_lat, a.longitude as dest_lng
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         JOIN users u ON u.id = o.user_id
         LEFT JOIN addresses a ON a.id = o.address_id
         WHERE da.delivery_partner_id = ? AND da.status NOT IN ${TERMINAL_LIST_SQL}
         ORDER BY CASE WHEN da.priority = 'URGENT' THEN 0 ELSE 1 END, da.assigned_at DESC`
      )
      .all(partner.id as string);

    const unreadNotifications = sqlite
      .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(partner.user_id as string) as { c: number };

    res.json({
      partner,
      stats: {
        activeCount: activeCount.c,
        pendingCount: pendingCount.c,
        completedTodayCount: completedToday.c,
        completedCount: completedTotal.c,
        pendingCashCollectionPaise: pendingCod.total_paise,
        pendingCashOrdersCount: pendingCod.cod_orders,
        unreadNotifications: unreadNotifications.c,
        gpsRetentionDays: LOCATION_RETENTION_DAYS,
      },
      activeAssignments,
      store: getPublicStoreInfo(),
    });
  });

  router.get('/assignments', (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Delivery partner profile not found' });
      return;
    }

    const assignments = sqlite
      .prepare(
        `SELECT da.id, da.order_id, da.status, da.priority, da.assigned_at, da.accepted_at,
                da.picked_up_at, da.estimated_distance_km, da.pickup_time_target, da.failure_reason,
                o.order_number, o.total_paise, o.payment_method, o.payment_status, o.status as order_status,
                o.delivery_notes,
                u.full_name as customer_name, u.phone as customer_phone,
                a.line1, a.landmark, a.city, a.postal_code, a.latitude as dest_lat, a.longitude as dest_lng
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         JOIN users u ON u.id = o.user_id
         LEFT JOIN addresses a ON a.id = o.address_id
         WHERE da.delivery_partner_id = ? AND da.status NOT IN ${TERMINAL_LIST_SQL}
         ORDER BY CASE WHEN da.priority = 'URGENT' THEN 0 ELSE 1 END, da.assigned_at DESC`
      )
      .all(partner.id as string);

    res.json({ assignments, store: getPublicStoreInfo() });
  });

  router.get('/orders/:id', (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Delivery partner profile not found' });
      return;
    }

    // Security & Privacy: NEVER expose prescription images/records, clinical notes, or raw delivery_otp to driver
    const detail = sqlite
      .prepare(
        `SELECT da.id, da.order_id, da.store_id, da.delivery_partner_id, da.status, da.priority,
                da.assigned_at, da.accepted_at, da.arrived_at_store_at, da.picked_up_at,
                da.arrived_at_customer_at, da.delivered_at, da.returned_at,
                da.estimated_distance_km, da.pickup_time_target, da.proof_note, da.failure_reason,
                da.signature_data_url, da.pod_photo_url, da.cash_collected_paise,
                o.order_number, o.total_paise, o.payment_method, o.payment_status, o.status as order_status,
                o.delivery_notes,
                CASE WHEN o.delivery_otp IS NOT NULL THEN 1 ELSE 0 END as otp_required,
                o.delivery_otp_attempts, o.delivery_otp_locked_until, o.delivery_otp_expires_at,
                u.full_name as customer_name, u.phone as customer_phone,
                a.line1, a.line2, a.landmark, a.city, a.postal_code, a.latitude as dest_lat, a.longitude as dest_lng
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         JOIN users u ON u.id = o.user_id
         LEFT JOIN addresses a ON a.id = o.address_id
         WHERE (da.order_id = ? OR da.id = ?) AND da.delivery_partner_id = ?`
      )
      .get(req.params.id, req.params.id, partner.id as string) as Record<string, unknown> | undefined;

    if (!detail) {
      res.status(404).json({ error: 'Assigned order not found' });
      return;
    }

    const items = sqlite
      .prepare('SELECT id, medicine_name, pack_size, quantity FROM order_items WHERE order_id = ?')
      .all(detail.order_id as string);

    const rawPod = String(detail.pod_photo_url || '');
    const podFile = rawPod.split('/').pop() || '';
    const signedPodUrl = rawPod.startsWith('/uploads/pod/') ? createSignedFileUrl('pod', podFile) : rawPod || null;

    const allowedNextStates = ALLOWED_DELIVERY_TRANSITIONS[String(detail.status)] || [];
    res.json({
      assignment: {
        ...detail,
        signed_pod_photo_url: signedPodUrl,
      },
      items,
      partner,
      store: getPublicStoreInfo(),
      allowedNextStates,
    });
  });

  router.post('/orders/:id/accept', (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }
    if (partner.account_status === 'SUSPENDED') {
      res.status(403).json({ error: 'Account suspended' });
      return;
    }

    const parsed = z.object({ clientEventId: z.string().max(100).optional() }).safeParse(req.body || {});
    const now = new Date().toISOString();

    if (parsed.success && parsed.data.clientEventId) {
      const replay = sqlite
        .prepare('SELECT response_json FROM delivery_offline_events WHERE idempotency_key = ?')
        .get(parsed.data.clientEventId) as { response_json: string | null } | undefined;
      if (replay) {
        res.json({ ok: true, idempotentReplay: true, status: DeliveryAssignmentStatus.ACCEPTED });
        return;
      }
    }

    const existing = sqlite
      .prepare('SELECT id, order_id, store_id, status FROM delivery_assignments WHERE (order_id = ? OR id = ?) AND delivery_partner_id = ?')
      .get(req.params.id, req.params.id, partner.id as string) as
      | { id: string; order_id: string; store_id: string; status: string }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Assignment no longer exists or was reassigned to another driver.' });
      return;
    }

    const result = sqlite
      .prepare(
        `UPDATE delivery_assignments
         SET status = ?, accepted_at = COALESCE(accepted_at, ?), last_event_seq = last_event_seq + 1, updated_at = ?
         WHERE id = ? AND delivery_partner_id = ? AND status = 'ASSIGNED'`
      )
      .run(DeliveryAssignmentStatus.ACCEPTED, now, now, existing.id, partner.id as string);

    if (result.changes === 0) {
      res.status(409).json({
        error: `Assignment cannot be accepted (current status: ${existing.status}).`,
      });
      return;
    }

    sqlite
      .prepare('INSERT INTO order_status_history (id, order_id, status, note, changed_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        crypto.randomUUID(),
        existing.order_id,
        OrderStatus.DRIVER_ASSIGNED,
        `Delivery assignment accepted by ${String(partner.full_name)}`,
        req.auth!.userId,
        now
      );

    if (parsed.success && parsed.data.clientEventId) {
      sqlite
        .prepare('INSERT OR IGNORE INTO delivery_offline_events (idempotency_key, assignment_id, event_type, response_json, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(parsed.data.clientEventId, existing.id, 'ACCEPT', JSON.stringify({ status: DeliveryAssignmentStatus.ACCEPTED }), now);
    }

    const payload = {
      orderId: existing.order_id,
      deliveryPartnerId: partner.id,
      deliveryStatus: DeliveryAssignmentStatus.ACCEPTED,
      acceptedAt: now,
    };
    realtimeService.emitOrderUpdate(existing.order_id, existing.store_id, payload, partner.id as string);
    realtimeService.emitEvent({
      event: 'delivery.accepted',
      orderId: existing.order_id,
      storeId: existing.store_id,
      partnerId: partner.id as string,
      payload,
    });

    res.json({ ok: true, status: DeliveryAssignmentStatus.ACCEPTED });
  });

  router.post('/orders/:id/reject', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        reason: z.string().trim().min(3, 'Please provide a rejection reason (min 3 characters)').max(300),
        clientEventId: z.string().max(100).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Rejection reason is required' });
      return;
    }

    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    const out = applyAssignmentStatusTransition({
      partner,
      orderIdParam: req.params.id,
      nextStatus: DeliveryAssignmentStatus.ASSIGNMENT_REJECTED,
      reason: parsed.data.reason,
      clientEventId: parsed.data.clientEventId,
      actorUserId: req.auth!.userId,
    });
    res.status(out.statusCode).json(out.body);
  });

  router.patch('/orders/:id/status', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        status: z.enum([
          DeliveryAssignmentStatus.ACCEPTED,
          DeliveryAssignmentStatus.ARRIVED_AT_STORE,
          DeliveryAssignmentStatus.PICKED_UP,
          DeliveryAssignmentStatus.OUT_FOR_DELIVERY,
          DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER,
          DeliveryAssignmentStatus.DELIVERED,
          DeliveryAssignmentStatus.ASSIGNMENT_REJECTED,
          DeliveryAssignmentStatus.DELIVERY_FAILED,
          DeliveryAssignmentStatus.RETURNING_TO_STORE,
          DeliveryAssignmentStatus.RETURNED,
          DeliveryAssignmentStatus.CANCELLED,
        ]),
        proofNote: z.string().trim().max(300).optional(),
        reason: z.string().trim().max(300).optional(),
        otp: z.string().trim().max(10).optional(),
        signatureDataUrl: z.string().max(300000).optional(),
        podPhotoUrl: z.string().max(500).optional(),
        cashCollectedPaise: z.number().int().min(0).optional(),
        clientEventId: z.string().max(100).optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid delivery status payload', issues: parsed.error.flatten() });
      return;
    }

    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }
    if (partner.account_status === 'SUSPENDED') {
      res.status(403).json({ error: 'Delivery partner account is suspended' });
      return;
    }

    const out = applyAssignmentStatusTransition({
      partner,
      orderIdParam: req.params.id,
      nextStatus: parsed.data.status,
      proofNote: parsed.data.proofNote,
      reason: parsed.data.reason,
      otp: parsed.data.otp,
      signatureDataUrl: parsed.data.signatureDataUrl,
      podPhotoUrl: parsed.data.podPhotoUrl,
      cashCollectedPaise: parsed.data.cashCollectedPaise,
      clientEventId: parsed.data.clientEventId,
      actorUserId: req.auth!.userId,
    });

    res.status(out.statusCode).json(out.body);
  });

  router.post('/orders/:id/pod-photo', podUpload.single('file'), async (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Proof of delivery photo is required' });
      return;
    }
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMime.includes(req.file.mimetype)) {
      res.status(400).json({ error: 'Only JPG, PNG, or WEBP delivery photos are allowed' });
      return;
    }

    const existing = sqlite
      .prepare('SELECT id FROM delivery_assignments WHERE (order_id = ? OR id = ?) AND delivery_partner_id = ?')
      .get(req.params.id, req.params.id, partner.id as string) as { id: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Assignment not found' });
      return;
    }

    const scan = await malwareScannerService.scanBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!scan.safe) {
      res.status(400).json({ error: scan.reason || 'Uploaded proof photo failed security validation' });
      return;
    }

    const saved = await storageService.saveFile({
      folder: 'pod',
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
    });
    sqlite
      .prepare('UPDATE delivery_assignments SET pod_photo_url = ?, updated_at = ? WHERE id = ?')
      .run(saved.publicUrl, new Date().toISOString(), existing.id);

    const fname = saved.publicUrl.split('/').pop() || '';
    res.status(201).json({
      ok: true,
      podPhotoUrl: saved.publicUrl,
      signedPodPhotoUrl: createSignedFileUrl('pod', fname),
    });
  });

  router.post('/offline-sync', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        events: z
          .array(
            z.object({
              clientEventId: z.string().min(4).max(100),
              orderId: z.string().min(1),
              status: z.enum([
                DeliveryAssignmentStatus.ACCEPTED,
                DeliveryAssignmentStatus.ARRIVED_AT_STORE,
                DeliveryAssignmentStatus.PICKED_UP,
                DeliveryAssignmentStatus.OUT_FOR_DELIVERY,
                DeliveryAssignmentStatus.ARRIVED_AT_CUSTOMER,
                DeliveryAssignmentStatus.DELIVERY_FAILED,
                DeliveryAssignmentStatus.RETURNING_TO_STORE,
              ]),
              proofNote: z.string().max(300).optional(),
              reason: z.string().max(300).optional(),
            })
          )
          .max(25),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid offline sync batch payload' });
      return;
    }

    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    const results: Array<{ clientEventId: string; statusCode: number; ok: boolean; error?: string }> = [];
    for (const ev of parsed.data.events) {
      const out = applyAssignmentStatusTransition({
        partner,
        orderIdParam: ev.orderId,
        nextStatus: ev.status,
        proofNote: ev.proofNote,
        reason: ev.reason,
        clientEventId: ev.clientEventId,
        actorUserId: req.auth!.userId,
      });
      results.push({
        clientEventId: ev.clientEventId,
        statusCode: out.statusCode,
        ok: out.statusCode >= 200 && out.statusCode < 300,
        error: typeof out.body.error === 'string' ? out.body.error : undefined,
      });
    }

    res.json({ synced: results });
  });

  router.post('/location', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        orderId: z.string().min(1, 'Active assignment orderId is required for location updates'),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        heading: z.number().min(0).max(360).optional().nullable(),
        speedKmh: z.number().min(0).max(300).optional().nullable(),
        accuracyM: z.number().min(0).max(5000).optional().nullable(),
        deviceTimestamp: z.string().optional().nullable(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Valid GPS coordinates and active assignment ID are required' });
      return;
    }

    if (parsed.data.latitude === 0 && parsed.data.longitude === 0) {
      res.status(400).json({ error: 'Invalid zero GPS coordinates rejected' });
      return;
    }

    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Delivery partner not found' });
      return;
    }
    if (partner.account_status === 'SUSPENDED') {
      res.status(403).json({ error: 'Delivery partner account is suspended' });
      return;
    }

    // Strict tracking boundary: only allow GPS telemetry during an authorized active delivery assignment
    const trackableStatuses = TRACKABLE_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(',');
    const activeAssignment = sqlite
      .prepare(
        `SELECT id, order_id, status
         FROM delivery_assignments
         WHERE delivery_partner_id = ?
           AND (order_id = ? OR id = ?)
           AND status IN (${trackableStatuses})`
      )
      .get(partner.id as string, parsed.data.orderId, parsed.data.orderId) as
      | { id: string; order_id: string; status: string }
      | undefined;

    if (!activeAssignment) {
      res.status(403).json({
        error: 'Location tracking is authorized only during an accepted, active delivery assignment.',
      });
      return;
    }

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    let deviceTs = parsed.data.deviceTimestamp || now;
    const deviceMs = Date.parse(deviceTs);
    if (Number.isNaN(deviceMs) || deviceMs > nowMs + 5 * 60 * 1000) {
      deviceTs = now;
    }

    // Anomaly / impossible jump check against recent recorded coordinate
    let isSuspicious = false;
    let suspiciousReason: string | null = null;
    const prevLoc = sqlite
      .prepare(
        `SELECT latitude, longitude, recorded_at
         FROM driver_locations
         WHERE delivery_partner_id = ? AND COALESCE(is_suspicious, 0) = 0
         ORDER BY recorded_at DESC
         LIMIT 1`
      )
      .get(partner.id as string) as { latitude: number; longitude: number; recorded_at: string } | undefined;

    if (prevLoc) {
      const elapsedHours = Math.max(1 / 3600, (nowMs - new Date(prevLoc.recorded_at).getTime()) / 3600000);
      const jumpKm = mapsAdapter.computeDistanceKm(
        { lat: prevLoc.latitude, lng: prevLoc.longitude },
        { lat: parsed.data.latitude, lng: parsed.data.longitude }
      );
      const impliedSpeedKmh = jumpKm / elapsedHours;
      if ((elapsedHours < 1 && impliedSpeedKmh > 140 && jumpKm > 1.5) || (elapsedHours < 0.01 && jumpKm > 3)) {
        isSuspicious = true;
        suspiciousReason = `Implied travel speed ${Math.round(impliedSpeedKmh)} km/h across ${jumpKm} km`;
      }
    }

    sqlite
      .prepare(
        `INSERT INTO driver_locations (
           id, delivery_partner_id, order_id, latitude, longitude, heading, speed_kmh, accuracy_m,
           device_timestamp, is_suspicious, suspicious_reason, tracking_status, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        partner.id as string,
        activeAssignment.order_id,
        parsed.data.latitude,
        parsed.data.longitude,
        parsed.data.heading ?? null,
        parsed.data.speedKmh ?? null,
        parsed.data.accuracyM ?? null,
        deviceTs,
        isSuspicious ? 1 : 0,
        suspiciousReason,
        activeAssignment.status,
        now
      );

    // Only update authoritative partner current_lat/lng if ping is not flagged as an impossible teleport
    if (!isSuspicious) {
      sqlite
        .prepare(
          'UPDATE delivery_partners SET current_lat = ?, current_lng = ?, location_accuracy_m = ?, last_location_at = ?, updated_at = ? WHERE id = ?'
        )
        .run(
          parsed.data.latitude,
          parsed.data.longitude,
          parsed.data.accuracyM ?? null,
          now,
          now,
          partner.id as string
        );
    }

    maybePruneOldLocations();

    realtimeService.emitDriverLocation(activeAssignment.order_id, partner.store_id as string, {
      deliveryPartnerId: partner.id as string,
      orderId: activeAssignment.order_id,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      heading: parsed.data.heading ?? null,
      speedKmh: parsed.data.speedKmh ?? null,
      accuracyM: parsed.data.accuracyM ?? null,
      isSuspicious,
      recordedAt: now,
    });

    res.json({
      ok: true,
      recordedAt: now,
      isSuspicious,
      suspiciousReason,
    });
  });

  router.get('/history', (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    const history = sqlite
      .prepare(
        `SELECT da.id, da.order_id, da.status, da.assigned_at, da.picked_up_at, da.delivered_at,
                da.returned_at, da.rejection_reason, da.failure_reason, da.cash_collected_paise, da.updated_at,
                o.order_number, o.total_paise, o.payment_method, o.payment_status, o.cod_reconciled,
                u.full_name as customer_name, a.line1, a.city
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         JOIN users u ON u.id = o.user_id
         LEFT JOIN addresses a ON a.id = o.address_id
         WHERE da.delivery_partner_id = ? AND da.status IN ${TERMINAL_LIST_SQL}
         ORDER BY da.updated_at DESC`
      )
      .all(partner.id as string);

    res.json({ history });
  });

  router.get('/cash-summary', (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    const codDeliveries = sqlite
      .prepare(
        `SELECT da.id, da.order_id, o.order_number, o.total_paise,
                COALESCE(da.cash_collected_paise, o.total_paise) as collected_paise,
                COALESCE(o.cod_reconciled, 0) as cod_reconciled, o.cod_reconciled_at,
                da.delivered_at, u.full_name as customer_name
         FROM delivery_assignments da
         JOIN orders o ON o.id = da.order_id
         JOIN users u ON u.id = o.user_id
         WHERE da.delivery_partner_id = ? AND da.status = 'DELIVERED' AND o.payment_method = 'CASH_ON_DELIVERY'
         ORDER BY da.delivered_at DESC`
      )
      .all(partner.id as string) as Array<{
      id: string;
      order_id: string;
      order_number: string;
      total_paise: number;
      collected_paise: number;
      cod_reconciled: number;
      cod_reconciled_at: string | null;
      delivered_at: string | null;
      customer_name: string;
    }>;

    const totalCollectedPaise = codDeliveries.reduce((s, d) => s + Number(d.collected_paise), 0);
    const settledPaise = codDeliveries.filter((d) => d.cod_reconciled === 1).reduce((s, d) => s + Number(d.collected_paise), 0);
    const pendingSettlementPaise = totalCollectedPaise - settledPaise;

    res.json({
      totalCollectedPaise,
      settledPaise,
      pendingSettlementPaise,
      codDeliveries,
    });
  });

  router.get('/notifications', (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }
    const rows = sqlite
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(partner.user_id as string);
    res.json({ notifications: rows });
  });

  router.post('/notifications/mark-read', (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }
    sqlite.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(partner.user_id as string);
    res.json({ ok: true });
  });

  router.get('/profile', (req: AuthenticatedRequest, res) => {
    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }
    res.json({ partner, store: getPublicStoreInfo() });
  });

  router.patch('/profile', (req: AuthenticatedRequest, res) => {
    const parsed = z
      .object({
        isAvailable: z.boolean().optional(),
        isOnShift: z.boolean().optional(),
        vehicleType: z.string().trim().min(2).max(60).optional(),
        vehicleNumber: z.string().trim().min(3).max(30).optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid profile update' });
      return;
    }

    const partner = getPartnerForRequest(req);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    // Duty online status indicates availability for assignments; if going off shift, also mark unavailable
    const nextOnShift = parsed.data.isOnShift !== undefined ? (parsed.data.isOnShift ? 1 : 0) : Number(partner.is_on_shift);
    const nextAvailable =
      parsed.data.isOnShift === false
        ? 0
        : parsed.data.isAvailable !== undefined
          ? parsed.data.isAvailable
            ? 1
            : 0
          : parsed.data.isOnShift === true
            ? 1
            : Number(partner.is_available);

    sqlite
      .prepare(
        `UPDATE delivery_partners
         SET is_available = ?, is_on_shift = ?, vehicle_type = ?, vehicle_number = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        nextAvailable,
        nextOnShift,
        parsed.data.vehicleType || String(partner.vehicle_type),
        parsed.data.vehicleNumber || String(partner.vehicle_number),
        new Date().toISOString(),
        partner.id as string
      );

    res.json({ partner: getPartnerForRequest(req) });
  });

  return router;
}
