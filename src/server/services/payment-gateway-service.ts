import crypto from 'node:crypto';
import { sqlite } from '../db/sqlite-db.ts';
import type { IPaymentGatewayService } from '../interfaces/services.ts';
import type { PaymentMethod, RazorpayOrderInitDTO } from '../../shared/types.ts';

function getRazorpayKeyId(): string {
  return process.env.RAZORPAY_KEY_ID || 'rzp_test_slm_mira_demo';
}

function getRazorpayKeySecret(): string {
  return process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_SECRET || 'slm_razorpay_test_secret_2026';
}

function getRazorpayWebhookSecret(): string {
  return process.env.RAZORPAY_WEBHOOK_SECRET || getRazorpayKeySecret();
}

class RazorpayGatewayService implements IPaymentGatewayService {
  isLiveModeAllowed(storeId: string): { allowed: boolean; reason?: string } {
    const keyId = getRazorpayKeyId();
    const onboarding = sqlite
      .prepare('SELECT compliance_signed_off, production_sales_enabled FROM store_onboarding_state WHERE store_id = ?')
      .get(storeId) as { compliance_signed_off: number; production_sales_enabled: number } | undefined;

    if (process.env.PRODUCTION_SALES_APPROVED !== 'true') {
      return {
        allowed: false,
        reason: 'Live payments locked until PRODUCTION_SALES_APPROVED=true is configured in production environment.',
      };
    }
    if (!onboarding?.compliance_signed_off || !onboarding?.production_sales_enabled) {
      return {
        allowed: false,
        reason: 'Store compliance checklist & onboarding wizard must be signed off before enabling live payments.',
      };
    }
    if (!keyId.startsWith('rzp_live_') || !process.env.RAZORPAY_KEY_SECRET) {
      return {
        allowed: false,
        reason: 'Live Razorpay merchant keys (rzp_live_*) and secret are required for production payments.',
      };
    }
    return { allowed: true };
  }

  async createGatewayOrder(params: {
    storeId: string;
    userId: string;
    orderId?: string;
    amountPaise: number;
    method: PaymentMethod;
    receipt: string;
  }): Promise<RazorpayOrderInitDTO> {
    if (params.amountPaise <= 0) {
      throw new Error('Payment amount must be greater than zero');
    }

    const user = sqlite
      .prepare('SELECT full_name, email, phone FROM users WHERE id = ?')
      .get(params.userId) as { full_name: string; email: string; phone: string | null } | undefined;

    const store = sqlite
      .prepare('SELECT name FROM stores WHERE id = ?')
      .get(params.storeId) as { name: string } | undefined;

    const keyId = getRazorpayKeyId();
    const keySecret = getRazorpayKeySecret();
    const liveCheck = this.isLiveModeAllowed(params.storeId);
    const isTestMode = !liveCheck.allowed || keyId.startsWith('rzp_test_');

    // If real Razorpay test/live API credentials are provided in env, create order directly with Razorpay REST API
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      try {
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const resp = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: params.amountPaise,
            currency: 'INR',
            receipt: params.receipt.slice(0, 40),
            notes: {
              storeId: params.storeId,
              orderId: params.orderId || '',
              method: params.method,
            },
          }),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { id: string; amount: number };
          return {
            gatewayOrderId: data.id,
            orderId: params.orderId,
            amountPaise: data.amount,
            currency: 'INR',
            keyId,
            testMode: isTestMode,
            merchantName: store?.name || 'Shree Leela Medical & General Stores',
            prefill: {
              name: user?.full_name || 'Customer',
              email: user?.email || '',
              contact: user?.phone || '',
            },
          };
        }
      } catch {
        // Fall through to deterministic Razorpay Test Mode order creation if offline/sandboxed
      }
    }

    const gatewayOrderId = `order_slm_test_${crypto.randomBytes(7).toString('hex')}`;
    return {
      gatewayOrderId,
      orderId: params.orderId,
      amountPaise: params.amountPaise,
      currency: 'INR',
      keyId,
      testMode: true,
      merchantName: store?.name || 'Shree Leela Medical & General Stores',
      prefill: {
        name: user?.full_name || 'Customer',
        email: user?.email || '',
        contact: user?.phone || '',
      },
    };
  }

  generateTestSignature(gatewayOrderId: string, gatewayPaymentId: string): string {
    return crypto
      .createHmac('sha256', getRazorpayKeySecret())
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest('hex');
  }

  verifySignature(params: {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
  }): boolean {
    if (!params.gatewayOrderId || !params.gatewayPaymentId || !params.signature) return false;
    const expected = this.generateTestSignature(params.gatewayOrderId, params.gatewayPaymentId);
    if (expected.length !== params.signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(params.signature, 'utf8'));
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    if (!rawBody || !signatureHeader) return false;
    const expected = crypto
      .createHmac('sha256', getRazorpayWebhookSecret())
      .update(rawBody)
      .digest('hex');
    if (expected.length !== signatureHeader.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signatureHeader, 'utf8'));
  }

  generateWebhookSignature(rawBody: string): string {
    return crypto
      .createHmac('sha256', getRazorpayWebhookSecret())
      .update(rawBody)
      .digest('hex');
  }
}

export const paymentGatewayService = new RazorpayGatewayService();
