import crypto from 'node:crypto';
import { sqlite, databaseService } from '../db/sqlite-db.ts';
import { realtimeService } from './realtime-service.ts';
import { notificationService } from './notification-service.ts';
import type { IOrderLifecycleService } from '../interfaces/services.ts';
import {
  ALLOWED_ORDER_TRANSITIONS,
  normalizeLegacyOrderStatus,
  OrderStatus,
  PrescriptionStatus,
  Role,
} from '../../shared/types.ts';

export class OrderLifecycleError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 400, code = 'INVALID_STATE_TRANSITION') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

class CentralOrderLifecycleService implements IOrderLifecycleService {
  transition(params: {
    orderId: string;
    storeId: string;
    nextStatus: OrderStatus;
    actorUserId: string;
    actorRoles?: Role[];
    reason?: string;
    note?: string;
    bypassGuard?: boolean;
  }): { previousStatus: OrderStatus; newStatus: OrderStatus } {
    const order = sqlite
      .prepare(
        `SELECT id, order_number, store_id, user_id, status, prescription_status, fulfillment_type, payment_method, payment_status
         FROM orders
         WHERE id = ? AND store_id = ?`
      )
      .get(params.orderId, params.storeId) as
      | {
          id: string;
          order_number: string;
          store_id: string;
          user_id: string;
          status: string;
          prescription_status: string;
          fulfillment_type: string;
          payment_method: string;
          payment_status: string;
        }
      | undefined;

    if (!order) {
      throw new OrderLifecycleError('Order not found in store', 404, 'NOT_FOUND');
    }

    const currentStatus = normalizeLegacyOrderStatus(order.status);
    const nextStatus = normalizeLegacyOrderStatus(params.nextStatus);
    const reasonText = (params.reason || params.note || '').trim();

    if (currentStatus === nextStatus) {
      return { previousStatus: currentStatus, newStatus: nextStatus };
    }

    // Enforce prescription compliance gate for dispensing/fulfillment states
    const fulfillmentStates: OrderStatus[] = [
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.PACKED,
      OrderStatus.READY_FOR_DISPATCH,
      OrderStatus.DRIVER_ASSIGNED,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.COLLECTED,
      OrderStatus.DELIVERED,
    ];
    if (
      order.prescription_status !== PrescriptionStatus.NOT_REQUIRED &&
      order.prescription_status !== PrescriptionStatus.APPROVED &&
      fulfillmentStates.includes(nextStatus)
    ) {
      throw new OrderLifecycleError(
        'Cannot advance order before a Registered Pharmacist approves the prescription.',
        403,
        'RX_GATE_BLOCKED'
      );
    }

    const allowedNext = ALLOWED_ORDER_TRANSITIONS[currentStatus] || [];
    const isSuperAdminOverride = Boolean(
      params.bypassGuard && params.actorRoles?.includes(Role.SUPER_ADMIN) && reasonText.length >= 3
    );

    if (!isSuperAdminOverride && !allowedNext.includes(nextStatus)) {
      throw new OrderLifecycleError(
        `Invalid order state transition from ${currentStatus} to ${nextStatus}. Allowed: ${
          allowedNext.length ? allowedNext.join(', ') : 'None (terminal state)'
        }`,
        400,
        'INVALID_STATE_TRANSITION'
      );
    }

    if (nextStatus === OrderStatus.CANCELLED && reasonText.length < 3) {
      throw new OrderLifecycleError(
        'A documented cancellation reason (minimum 3 characters) is mandatory.',
        400,
        'REASON_REQUIRED'
      );
    }

    if (
      (currentStatus === OrderStatus.DELIVERED ||
        currentStatus === OrderStatus.COLLECTED ||
        currentStatus === OrderStatus.CANCELLED) &&
      reasonText.length < 3
    ) {
      throw new OrderLifecycleError(
        'A documented reason is mandatory for post-completion exception transitions.',
        400,
        'REASON_REQUIRED'
      );
    }

    const now = new Date().toISOString();
    databaseService.withTransaction(() => {
      sqlite
        .prepare(
          `UPDATE orders
           SET status = ?,
               cancellation_reason = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancellation_reason END,
               updated_at = ?
           WHERE id = ?`
        )
        .run(nextStatus, nextStatus, reasonText || null, now, order.id);

      sqlite
        .prepare(
          'INSERT INTO order_status_history (id, order_id, status, note, changed_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(
          crypto.randomUUID(),
          order.id,
          nextStatus,
          reasonText || `Order updated to ${nextStatus.replace(/_/g, ' ')}`,
          params.actorUserId,
          now
        );
    });

    // Trigger structured notifications & live events
    const templateMap: Partial<Record<OrderStatus, 'ORDER_CONFIRMED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'ORDER_CANCELLED'>> = {
      [OrderStatus.CONFIRMED]: 'ORDER_CONFIRMED',
      [OrderStatus.OUT_FOR_DELIVERY]: 'OUT_FOR_DELIVERY',
      [OrderStatus.DELIVERED]: 'DELIVERED',
      [OrderStatus.COLLECTED]: 'DELIVERED',
      [OrderStatus.CANCELLED]: 'ORDER_CANCELLED',
    };
    const tpl = templateMap[nextStatus];
    if (tpl) {
      void notificationService.notify({
        userId: order.user_id,
        orderId: order.id,
        template: tpl,
        variables: { orderNumber: order.order_number, reason: reasonText },
      });
    } else {
      sqlite
        .prepare(
          'INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
        )
        .run(
          crypto.randomUUID(),
          order.user_id,
          `Order ${order.order_number} Updated`,
          `Order status updated to ${nextStatus.replace(/_/g, ' ')}.`,
          'ORDER_UPDATE',
          now
        );
    }

    realtimeService.emitOrderUpdate(order.id, order.store_id, {
      orderId: order.id,
      orderNumber: order.order_number,
      status: nextStatus,
      previousStatus: currentStatus,
    });

    return { previousStatus: currentStatus, newStatus: nextStatus };
  }
}

export const orderLifecycleService = new CentralOrderLifecycleService();
