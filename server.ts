import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { databaseService, initSchemaAndSeed, sqlite } from './src/server/db/sqlite-db.ts';
import { attachOptionalAuth, type AuthenticatedRequest } from './src/server/services/auth-service.ts';
import { realtimeService } from './src/server/services/realtime-service.ts';
import { storageService } from './src/server/services/storage-service.ts';
import {
  createRateLimiter,
  csrfOriginGuard,
  securityHeadersMiddleware,
  structuredLoggerMiddleware,
  verifySignedFileToken,
} from './src/server/services/security-service.ts';
import { paymentGatewayService } from './src/server/services/payment-gateway-service.ts';
import { orderLifecycleService } from './src/server/services/order-lifecycle-service.ts';
import { notificationService } from './src/server/services/notification-service.ts';
import { createPublicCustomerRouter } from './src/server/routes/public-customer.ts';
import { createAdminRouter } from './src/server/routes/admin.ts';
import { createDeliveryRouter } from './src/server/routes/delivery.ts';
import { OrderStatus, PaymentStatus, PrescriptionStatus, Role } from './src/shared/types.ts';

dotenv.config();

initSchemaAndSeed();

const app = express();
const httpServer = http.createServer(app);
realtimeService.attach(httpServer);

app.set('trust proxy', 1);
app.use(securityHeadersMiddleware);
app.use(cookieParser());
app.use(
  express.json({
    limit: '4mb',
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(attachOptionalAuth);
app.use(structuredLoggerMiddleware);

// Rate Limiters on sensitive auth, checkout, upload, and dispatch endpoints
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60, keyPrefix: 'auth' });
const checkoutUploadLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 80, keyPrefix: 'write' });
const otpLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, keyPrefix: 'otp' });

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/orders', checkoutUploadLimiter);
app.use('/api/prescriptions', checkoutUploadLimiter);
app.use('/api/delivery/status', otpLimiter);

app.use('/api', csrfOriginGuard);

// Short-lived HMAC-signed private file download endpoint (prescriptions & proof-of-delivery photos)
app.get('/api/files/signed/:folder/:filename', (req, res) => {
  const folder = req.params.folder;
  if (folder !== 'prescriptions' && folder !== 'pod') {
    res.status(404).json({ error: 'Invalid private file scope' });
    return;
  }
  const expires = String(req.query.expires || '');
  const sig = String(req.query.sig || '');
  if (!verifySignedFileToken(folder, req.params.filename, expires, sig)) {
    res.status(403).json({ error: 'Signed file URL is invalid or expired', code: 'UNAUTHORIZED' });
    return;
  }
  const absPath = storageService.getAbsolutePath(`${folder}/${req.params.filename}`);
  if (!absPath) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(absPath);
});

// Razorpay Signed Webhook Endpoint (idempotent event ledger)
app.post('/api/webhooks/razorpay', (req: Request & { rawBody?: string }, res) => {
  const sig = String(req.headers['x-razorpay-signature'] || '');
  const rawBody = req.rawBody ?? JSON.stringify(req.body || {});
  if (!paymentGatewayService.verifyWebhookSignature(rawBody, sig)) {
    res.status(401).json({ error: 'Invalid webhook signature', code: 'UNAUTHORIZED' });
    return;
  }

  const body = (req.body || {}) as {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          order_id?: string;
          amount?: number;
          error_description?: string;
        };
      };
    };
  };

  const eventType = String(body.event || 'payment.captured');
  const entity = body.payload?.payment?.entity;
  const gatewayPaymentId = entity?.id ? String(entity.id) : null;
  const gatewayOrderId = entity?.order_id ? String(entity.order_id) : null;
  const eventId =
    String(req.headers['x-razorpay-event-id'] || '') ||
    `${eventType}:${gatewayOrderId || 'none'}:${gatewayPaymentId || 'none'}`;

  const existing = sqlite
    .prepare('SELECT event_id FROM payment_webhook_events WHERE event_id = ?')
    .get(eventId) as { event_id: string } | undefined;

  if (existing) {
    res.json({ ok: true, idempotentDuplicate: true, eventId });
    return;
  }

  const now = new Date().toISOString();
  databaseService.withTransaction(() => {
    sqlite
      .prepare(
        `INSERT INTO payment_webhook_events (event_id, provider, event_type, payment_id, gateway_order_id, signature_verified, payload_json, processed_at)
         VALUES (?, 'RAZORPAY', ?, ?, ?, 1, ?, ?)`
      )
      .run(eventId, eventType, gatewayPaymentId, gatewayOrderId, rawBody, now);

    if (!gatewayOrderId) return;

    const payment = sqlite
      .prepare(
        `SELECT p.id, p.order_id, p.status, o.store_id, o.user_id, o.order_number, o.status as order_status, o.prescription_status
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE p.gateway_order_id = ?
         LIMIT 1`
      )
      .get(gatewayOrderId) as
      | {
          id: string;
          order_id: string;
          status: string;
          store_id: string;
          user_id: string;
          order_number: string;
          order_status: string;
          prescription_status: string;
        }
      | undefined;

    if (!payment) return;

    if (eventType === 'payment.captured' && payment.status !== PaymentStatus.PAID) {
      sqlite
        .prepare(
          `UPDATE payments
           SET status = ?, gateway_payment_id = COALESCE(?, gateway_payment_id),
               provider_reference = COALESCE(?, provider_reference),
               signature_verified = 1, webhook_event_id = ?, paid_at = COALESCE(paid_at, ?), updated_at = ?
           WHERE id = ?`
        )
        .run(PaymentStatus.PAID, gatewayPaymentId, gatewayPaymentId, eventId, now, now, payment.id);

      sqlite
        .prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?')
        .run(PaymentStatus.PAID, now, payment.order_id);

      if (
        (payment.order_status === OrderStatus.PAYMENT_PENDING || payment.order_status === OrderStatus.ORDER_RECEIVED) &&
        (payment.prescription_status === PrescriptionStatus.NOT_REQUIRED || payment.prescription_status === PrescriptionStatus.APPROVED)
      ) {
        orderLifecycleService.transition({
          orderId: payment.order_id,
          storeId: payment.store_id,
          nextStatus: OrderStatus.CONFIRMED,
          actorUserId: payment.user_id,
          note: `Razorpay webhook confirmed (${gatewayPaymentId || eventId})`,
        });
      }

      void notificationService.notify({
        userId: payment.user_id,
        orderId: payment.order_id,
        template: 'PAYMENT_RECEIVED',
        variables: {
          orderNumber: payment.order_number,
          amountFormatted: entity?.amount ? `₹${(entity.amount / 100).toFixed(2)}` : '',
          reference: gatewayPaymentId || eventId,
        },
      });
    } else if (eventType === 'payment.failed' && payment.status !== PaymentStatus.PAID) {
      sqlite
        .prepare(
          `UPDATE payments
           SET status = ?, failure_reason = ?, webhook_event_id = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          PaymentStatus.FAILED,
          entity?.error_description || 'Payment failed at gateway webhook',
          eventId,
          now,
          payment.id
        );
      sqlite
        .prepare('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?')
        .run(PaymentStatus.FAILED, now, payment.order_id);
    }
  });

  res.json({ ok: true, eventId });
});

// Uploads route with strict private access gate for prescriptions & proof-of-delivery
app.get('/uploads/:folder/:filename', (req: AuthenticatedRequest, res) => {
  const allowedFolders = ['store', 'prescriptions', 'pod', 'medicines', 'partners'] as const;
  const folder = allowedFolders.includes(req.params.folder as (typeof allowedFolders)[number])
    ? req.params.folder
    : null;
  if (!folder) {
    res.status(404).end();
    return;
  }

  const publicUrl = `/uploads/${folder}/${req.params.filename}`;
  if (folder === 'prescriptions' || folder === 'pod') {
    const expires = String(req.query.expires || '');
    const sig = String(req.query.sig || '');
    const validSigned = expires && sig && verifySignedFileToken(folder, req.params.filename, expires, sig);

    if (!validSigned) {
      if (!req.auth) {
        res.status(401).json({ error: 'Authentication or signed URL required for private document', code: 'UNAUTHORIZED' });
        return;
      }
      const isStaff = req.auth.roles.some((r) =>
        ([Role.SUPER_ADMIN, Role.STORE_ADMIN, Role.PHARMACIST] as Role[]).includes(r)
      );
      if (!isStaff) {
        if (folder === 'prescriptions') {
          const ownsRx = sqlite
            .prepare('SELECT id FROM prescriptions WHERE file_url = ? AND user_id = ?')
            .get(publicUrl, req.auth.userId);
          if (!ownsRx) {
            res.status(403).json({ error: 'Not authorized to access this prescription', code: 'UNAUTHORIZED' });
            return;
          }
        } else if (folder === 'pod') {
          const ownsPod = sqlite
            .prepare(
              `SELECT da.id
               FROM delivery_assignments da
               JOIN orders o ON o.id = da.order_id
               LEFT JOIN delivery_partners dp ON dp.id = da.delivery_partner_id
               WHERE da.pod_photo_url = ? AND (o.user_id = ? OR dp.user_id = ?)`
            )
            .get(publicUrl, req.auth.userId, req.auth.userId);
          if (!ownsPod) {
            res.status(403).json({ error: 'Not authorized to access this proof of delivery', code: 'UNAUTHORIZED' });
            return;
          }
        }
      }
    }
    res.setHeader('Cache-Control', 'private, no-store');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }

  const absPath = storageService.getAbsolutePath(`${folder}/${req.params.filename}`);
  if (!absPath) {
    res.status(404).end();
    return;
  }
  res.sendFile(absPath);
});

app.use('/api', createPublicCustomerRouter());
app.use('/api/admin', createAdminRouter());
app.use('/api/delivery', createDeliveryRouter());

// Global JSON error handler for /api routes (never leak stack traces)
app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  const statusCode =
    typeof (err as { statusCode?: unknown })?.statusCode === 'number'
      ? (err as { statusCode: number }).statusCode
      : 500;
  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal pharmacy server error. Please try again.' : message,
    code: (err as { code?: string })?.code || (statusCode >= 500 ? 'SERVER_UNAVAILABLE' : 'BAD_REQUEST'),
  });
});

const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  const PORT = Number(process.env.PORT || 3000);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        message: 'Shree Leela Medical & General Stores platform listening',
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        razorpayKeyConfigured: Boolean(process.env.RAZORPAY_KEY_ID),
      })
    );
  });
}

function shutdown(signal: string) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', message: `Received ${signal}, shutting down gracefully` }));
  httpServer.close(() => {
    try {
      sqlite.close();
    } catch {
      // ignore close errors
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
