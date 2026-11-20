import type { AppErrorCode } from '../shared/types.ts';

export class ApiError extends Error {
  status: number;
  code: AppErrorCode | string;
  details?: unknown;

  constructor(message: string, status: number, code: string = 'UNKNOWN', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function generateIdempotencyKey(prefix = 'slm'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
  idempotencyKey?: string;
}

const DEFAULT_TIMEOUT_MS = 15000;

export async function apiFetch<T>(url: string, init?: ApiFetchOptions): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const isIdempotentGet = method === 'GET' || method === 'HEAD';
  const maxAttempts = isIdempotentGet ? 3 : 1;
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const isFormData = init?.body instanceof FormData;
  const baseHeaders: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };
  if (init?.idempotencyKey) {
    baseHeaders['Idempotency-Key'] = init.idempotencyKey;
  }

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        credentials: 'include',
        ...init,
        signal: init?.signal || controller.signal,
        headers: {
          ...baseHeaders,
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
      clearTimeout(timeoutId);

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        details?: unknown;
      };

      if (!res.ok) {
        const defaultCode =
          res.status === 401
            ? 'SESSION_EXPIRED'
            : res.status === 403
              ? 'UNAUTHORIZED'
              : res.status === 409
                ? 'STOCK_CHANGED'
                : res.status >= 500
                  ? 'SERVER_UNAVAILABLE'
                  : 'UNKNOWN';

        const apiErr = new ApiError(
          data.error || `Request failed (${res.status})`,
          res.status,
          data.code || defaultCode,
          data.details
        );

        if (isIdempotentGet && [502, 503, 504].includes(res.status) && attempt < maxAttempts) {
          lastErr = apiErr;
          await new Promise((r) => setTimeout(r, 350 * attempt));
          continue;
        }
        throw apiErr;
      }

      return data as T;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof ApiError) {
        throw err;
      }
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      lastErr = new ApiError(
        isAbort
          ? 'The server took too long to respond. Please check your connection and retry.'
          : 'Unable to reach pharmacy server. Check your internet connection and retry.',
        0,
        'SERVER_UNAVAILABLE'
      );
      if (isIdempotentGet && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 350 * attempt));
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr instanceof Error ? lastErr : new ApiError('Unexpected network failure', 0, 'SERVER_UNAVAILABLE');
}
