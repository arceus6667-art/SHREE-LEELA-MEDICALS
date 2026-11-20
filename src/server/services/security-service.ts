import 'dotenv/config';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { IMalwareScannerService } from '../interfaces/services.ts';
import type { AuthenticatedRequest } from './auth-service.ts';

const FILE_SIGNING_SECRET =
  ((process.env.FILE_SIGNING_SECRET?.length ?? 0) >= 32 ? process.env.FILE_SIGNING_SECRET : undefined) ||
  process.env.SESSION_SECRET ||
  'slm-dev-file-signing-secret-change-in-production';

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.setHeader('X-XSS-Protection', '0');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

// Periodically clear expired buckets
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets.entries()) {
    if (v.resetAt <= now) rateBuckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

export function createRateLimiter(opts: { windowMs: number; max: number; keyPrefix: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Allow internal test runner bypass only when explicit non-prod test flag is enabled
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${opts.keyPrefix}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Too many requests. Please retry in ${retryAfterSec} seconds.`,
        code: 'RATE_LIMITED',
      });
      return;
    }
    next();
  };
}

export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }
  // Signed external webhooks authenticate via cryptographic signature, not browser Origin
  if (req.path.startsWith('/webhooks/')) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  try {
    const originHost = new URL(origin).host;
    const reqHost = req.headers['x-forwarded-host']
      ? String(req.headers['x-forwarded-host']).split(',')[0].trim()
      : req.headers.host;
    const allowedExtra = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (originHost === reqHost || allowedExtra.includes(origin)) {
      next();
      return;
    }
  } catch {
    // Invalid origin URL
  }
  res.status(403).json({
    error: 'Cross-origin request rejected by security policy',
    code: 'UNAUTHORIZED',
  });
}

export function sanitizeTextInput(value: string): string {
  return value
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script>/gi, '')
    .replace(/[<>]/g, '')
    .trim();
}

export function structuredLoggerMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) return;
    const durationMs = Date.now() - start;
    const entry = {
      ts: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
      userId: req.auth?.userId || null,
      storeId: req.auth?.storeId || null,
    };
    if (process.env.NODE_ENV !== 'test') {
      console.log(JSON.stringify(entry));
    }
  });
  next();
}

const EICAR_SIG = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export const malwareScannerService: IMalwareScannerService = {
  async scanBuffer({ buffer, declaredMime }) {
    if (!buffer || buffer.length === 0) {
      return { clean: false, detectedMime: null, reason: 'Empty file buffer rejected' };
    }
    const headAscii = buffer.subarray(0, 128).toString('utf8');
    if (buffer.toString('utf8').includes(EICAR_SIG)) {
      return { clean: false, detectedMime: null, reason: 'Malware test signature detected and blocked' };
    }
    // Reject PE/ELF binaries and active HTML/script payloads
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
      return { clean: false, detectedMime: null, reason: 'Executable binary (MZ) rejected' };
    }
    if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
      return { clean: false, detectedMime: null, reason: 'Executable binary (ELF) rejected' };
    }
    if (/<\s*script|javascript:/i.test(headAscii)) {
      return { clean: false, detectedMime: null, reason: 'Script content rejected in uploaded document' };
    }

    // Magic-byte verification
    let detectedMime: string | null = null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      detectedMime = 'image/jpeg';
    } else if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      detectedMime = 'image/png';
    } else if (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      detectedMime = 'image/webp';
    } else if (buffer.subarray(0, 4).toString('ascii') === '%PDF') {
      detectedMime = 'application/pdf';
    }

    if (!detectedMime) {
      return {
        clean: false,
        detectedMime: null,
        reason: 'File content signature does not match an allowed JPG, PNG, WEBP, or PDF document',
      };
    }

    // Enforce consistent MIME family
    if (declaredMime && declaredMime !== detectedMime) {
      // Allow image/jpg alias for jpeg
      if (!(declaredMime === 'image/jpg' && detectedMime === 'image/jpeg')) {
        return {
          clean: false,
          detectedMime,
          reason: `File signature (${detectedMime}) does not match declared MIME type (${declaredMime})`,
        };
      }
    }

    return { clean: true, detectedMime };
  },
};

export function createSignedFileUrl(
  folder: 'prescriptions' | 'pod',
  filename: string,
  ttlSeconds = 900
): string {
  const safeName = pathBasenameSafe(filename);
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${folder}/${safeName}:${expires}`;
  const sig = crypto.createHmac('sha256', FILE_SIGNING_SECRET).update(payload).digest('hex');
  return `/api/files/signed/${folder}/${encodeURIComponent(safeName)}?expires=${expires}&sig=${sig}`;
}

export function verifySignedFileToken(
  folder: string,
  filename: string,
  expiresStr: string,
  sig: string
): boolean {
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const safeName = pathBasenameSafe(filename);
  const expected = crypto
    .createHmac('sha256', FILE_SIGNING_SECRET)
    .update(`${folder}/${safeName}:${expires}`)
    .digest('hex');

  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sig, 'utf8'));
}

function pathBasenameSafe(input: string): string {
  return input.replace(/^.*[\\/]/, '').replace(/\.\./g, '');
}
