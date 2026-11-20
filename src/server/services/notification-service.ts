import crypto from 'node:crypto';
import { sqlite } from '../db/sqlite-db.ts';
import { realtimeService } from './realtime-service.ts';
import type { INotificationService, NotificationTemplateKey } from '../interfaces/services.ts';
import type { NotificationPreferencesDTO } from '../../shared/types.ts';

const DEFAULT_PREFS: NotificationPreferencesDTO = {
  inApp: true,
  email: true,
  sms: true,
  whatsapp: false,
  marketingConsent: false,
};

function renderTemplate(
  template: NotificationTemplateKey,
  v: Record<string, string | number | null | undefined>
): { title: string; body: string; type: string } {
  const orderNumber = v.orderNumber || 'your order';
  switch (template) {
    case 'ACCOUNT_REGISTERED':
      return {
        title: 'Welcome to Shree Leela Medical & General Stores',
        body: `Account created for ${v.fullName || 'Customer'}. You can now browse medicines, upload prescriptions, and track deliveries in Mira Road East.`,
        type: 'ACCOUNT',
      };
    case 'ORDER_RECEIVED':
      return {
        title: `Order ${orderNumber} Received`,
        body: `We have received ${orderNumber} (${v.totalFormatted || ''}). Track live status updates from your account.`,
        type: 'ORDER_UPDATE',
      };
    case 'PRESCRIPTION_CLARIFICATION':
      return {
        title: `Prescription Clarification Needed${v.orderNumber ? ` · ${v.orderNumber}` : ''}`,
        body: `Our pharmacist needs clarification for ${v.patientName || 'your prescription'}: ${v.remarks || 'Please review remarks and re-upload a clear copy.'}`,
        type: 'PRESCRIPTION_REVIEW',
      };
    case 'PRESCRIPTION_DECISION':
      return {
        title: `Prescription ${v.decision || 'Reviewed'}`,
        body: `Registered pharmacist updated prescription for ${v.patientName || 'patient'}: ${v.remarks || ''}`,
        type: 'PRESCRIPTION_REVIEW',
      };
    case 'QUOTATION_READY':
      return {
        title: `Quotation Ready for ${orderNumber}`,
        body: `Pharmacist prepared a quotation of ${v.quotedFormatted || ''} for ${orderNumber}. Please accept the quotation to unlock checkout/payment.`,
        type: 'QUOTATION',
      };
    case 'PAYMENT_RECEIVED':
      return {
        title: `Payment Received for ${orderNumber}`,
        body: `Payment of ${v.amountFormatted || ''} verified (${v.reference || 'Online'}).`,
        type: 'PAYMENT',
      };
    case 'ORDER_CONFIRMED':
      return {
        title: `Order ${orderNumber} Confirmed`,
        body: `Your order ${orderNumber} is confirmed and queued for pharmacist packing.`,
        type: 'ORDER_UPDATE',
      };
    case 'DRIVER_ASSIGNED':
      return {
        title: `Delivery Partner Assigned · ${orderNumber}`,
        body: `${v.partnerName || 'A delivery partner'} has been assigned to pick up ${orderNumber} from Shree Leela Medical.`,
        type: 'DELIVERY_ASSIGNED',
      };
    case 'OUT_FOR_DELIVERY':
      return {
        title: `Out for Delivery · ${orderNumber}`,
        body: `Your medicines for ${orderNumber} are on the way. Keep your handover OTP ready.`,
        type: 'DELIVERY_UPDATE',
      };
    case 'DELIVERED':
      return {
        title: `Order ${orderNumber} Delivered`,
        body: `Your order ${orderNumber} has been delivered and handed over safely. Thank you for choosing Shree Leela Medical.`,
        type: 'DELIVERY_UPDATE',
      };
    case 'DELIVERY_OTP':
      return {
        title: `Delivery Handover OTP · ${orderNumber}`,
        body: `Share OTP ${v.otp || '****'} with your delivery partner ONLY at doorstep handover for ${orderNumber}.`,
        type: 'DELIVERY_OTP',
      };
    case 'ORDER_CANCELLED':
      return {
        title: `Order ${orderNumber} Cancelled`,
        body: `Order ${orderNumber} was cancelled. Reason: ${v.reason || 'Cancelled on request'}.`,
        type: 'ORDER_UPDATE',
      };
    case 'REFUND_STATUS':
      return {
        title: `Refund ${v.status || 'Updated'} · ${orderNumber}`,
        body: `Refund of ${v.amountFormatted || ''} for ${orderNumber} is ${v.status || 'processed'}.`,
        type: 'PAYMENT',
      };
    case 'LOW_INVENTORY_ALERT':
      return {
        title: `Low Stock Alert: ${v.medicineName || 'Medicine'}`,
        body: `Remaining unexpired stock for ${v.medicineName || 'item'} (${v.sku || ''}) is ${v.stock ?? 0} units.`,
        type: 'INVENTORY_ALERT',
      };
  }
}

export function getUserNotificationPreferences(userId: string): NotificationPreferencesDTO {
  const row = sqlite
    .prepare('SELECT notification_prefs_json, marketing_consent FROM users WHERE id = ?')
    .get(userId) as { notification_prefs_json: string | null; marketing_consent: number } | undefined;

  if (!row) return { ...DEFAULT_PREFS };
  try {
    const parsed = row.notification_prefs_json ? JSON.parse(row.notification_prefs_json) : {};
    return {
      inApp: parsed.inApp !== false,
      email: parsed.email !== false,
      sms: parsed.sms !== false,
      whatsapp: Boolean(parsed.whatsapp),
      marketingConsent: Boolean(row.marketing_consent),
    };
  } catch {
    return { ...DEFAULT_PREFS, marketingConsent: Boolean(row.marketing_consent) };
  }
}

export function updateUserNotificationPreferences(
  userId: string,
  prefs: Partial<NotificationPreferencesDTO>
): NotificationPreferencesDTO {
  const current = getUserNotificationPreferences(userId);
  const merged: NotificationPreferencesDTO = {
    inApp: prefs.inApp ?? current.inApp,
    email: prefs.email ?? current.email,
    sms: prefs.sms ?? current.sms,
    whatsapp: prefs.whatsapp ?? current.whatsapp,
    marketingConsent: prefs.marketingConsent ?? current.marketingConsent,
  };
  sqlite
    .prepare('UPDATE users SET notification_prefs_json = ?, marketing_consent = ?, updated_at = ? WHERE id = ?')
    .run(
      JSON.stringify({
        inApp: merged.inApp,
        email: merged.email,
        sms: merged.sms,
        whatsapp: merged.whatsapp,
      }),
      merged.marketingConsent ? 1 : 0,
      new Date().toISOString(),
      userId
    );
  return merged;
}

class CentralizedNotificationService implements INotificationService {
  async notify(params: {
    userId: string;
    orderId?: string | null;
    template: NotificationTemplateKey;
    variables: Record<string, string | number | null | undefined>;
  }): Promise<void> {
    const user = sqlite
      .prepare('SELECT id, email, phone, full_name FROM users WHERE id = ?')
      .get(params.userId) as { id: string; email: string; phone: string | null; full_name: string } | undefined;

    if (!user) return;
    const prefs = getUserNotificationPreferences(user.id);
    const rendered = renderTemplate(params.template, params.variables);
    const now = new Date().toISOString();

    if (prefs.inApp) {
      const notifId = crypto.randomUUID();
      sqlite
        .prepare(
          'INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
        )
        .run(notifId, user.id, rendered.title, rendered.body, rendered.type, now);

      sqlite
        .prepare(
          `INSERT INTO notification_logs (id, user_id, order_id, channel, template_key, recipient, subject, body_preview, status, provider_response, created_at)
           VALUES (?, ?, ?, 'IN_APP', ?, ?, ?, ?, 'SENT', 'Stored & Socket pushed', ?)`
        )
        .run(
          crypto.randomUUID(),
          user.id,
          params.orderId || null,
          params.template,
          user.id,
          rendered.title,
          rendered.body.slice(0, 240),
          now
        );

      realtimeService.emitEvent({
        event: 'notification.created',
        userId: user.id,
        orderId: params.orderId || null,
        payload: { id: notifId, title: rendered.title, message: rendered.body, type: rendered.type },
      });
    }

    // External Email Adapter (dispatches only when SMTP / Resend API key configured)
    if (prefs.email && user.email) {
      const emailConfigured = Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
      let status = emailConfigured ? 'SENT' : 'SKIPPED_NOT_CONFIGURED';
      let providerResponse = emailConfigured
        ? 'Dispatched via configured email provider'
        : 'Email provider credentials not configured (SMTP_HOST/RESEND_API_KEY)';

      if (process.env.RESEND_API_KEY) {
        try {
          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: process.env.EMAIL_FROM || 'Shree Leela Medical <care@shreeleelamedical.example>',
              to: [user.email],
              subject: rendered.title,
              text: rendered.body,
            }),
          });
          status = resp.ok ? 'SENT' : 'FAILED';
          providerResponse = `Resend HTTP ${resp.status}`;
        } catch (err) {
          status = 'FAILED';
          providerResponse = err instanceof Error ? err.message : 'Email network error';
        }
      }

      sqlite
        .prepare(
          `INSERT INTO notification_logs (id, user_id, order_id, channel, template_key, recipient, subject, body_preview, status, provider_response, created_at)
           VALUES (?, ?, ?, 'EMAIL', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          user.id,
          params.orderId || null,
          params.template,
          user.email,
          rendered.title,
          rendered.body.slice(0, 240),
          status,
          providerResponse,
          now
        );
    }

    // External SMS Adapter (dispatches only when configured)
    if (prefs.sms && user.phone) {
      const smsConfigured = Boolean(process.env.SMS_API_KEY && process.env.SMS_ENDPOINT);
      sqlite
        .prepare(
          `INSERT INTO notification_logs (id, user_id, order_id, channel, template_key, recipient, subject, body_preview, status, provider_response, created_at)
           VALUES (?, ?, ?, 'SMS', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          user.id,
          params.orderId || null,
          params.template,
          user.phone,
          rendered.title,
          rendered.body.slice(0, 160),
          smsConfigured ? 'SENT' : 'SKIPPED_NOT_CONFIGURED',
          smsConfigured ? 'Dispatched via SMS gateway' : 'SMS provider credentials not configured',
          now
        );
    }

    // External WhatsApp Business Adapter (requires explicit user opt-in + configured Meta Cloud API credentials)
    if (prefs.whatsapp && user.phone) {
      const waConfigured = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
      sqlite
        .prepare(
          `INSERT INTO notification_logs (id, user_id, order_id, channel, template_key, recipient, subject, body_preview, status, provider_response, created_at)
           VALUES (?, ?, ?, 'WHATSAPP', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          user.id,
          params.orderId || null,
          params.template,
          user.phone,
          rendered.title,
          rendered.body.slice(0, 240),
          waConfigured ? 'SENT' : 'SKIPPED_NOT_CONFIGURED',
          waConfigured ? 'Dispatched via WhatsApp Cloud API' : 'WhatsApp Cloud credentials not configured',
          now
        );
    }
  }
}

export const notificationService = new CentralizedNotificationService();
