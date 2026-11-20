import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { sqlite } from '../db/sqlite-db.ts';
import type { IAuthService, SessionPayload } from '../interfaces/services.ts';
import type { AuthUserDTO, Role } from '../../shared/types.ts';

export const SESSION_COOKIE_NAME = 'slm_session';
export const GUEST_CART_COOKIE_NAME = 'slm_guest_cart';

function hashSessionToken(token: string): string {
  const secret = process.env.SESSION_SECRET || 'shree-leela-dev-session-secret-key';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

export class BcryptCookieAuthService implements IAuthService {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async createSession(
    userId: string,
    rememberMe: boolean,
    userAgent?: string
  ): Promise<{ token: string; expiresAt: Date }> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(rawToken);
    const ttlMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);
    const now = new Date().toISOString();

    sqlite
      .prepare(
        `INSERT INTO user_sessions (id, user_id, token_hash, remember_me, user_agent, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        userId,
        tokenHash,
        rememberMe ? 1 : 0,
        (userAgent || '').slice(0, 250),
        expiresAt.toISOString(),
        now
      );

    sqlite.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, userId);

    return { token: rawToken, expiresAt };
  }

  async validateSessionToken(token: string): Promise<SessionPayload | null> {
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const row = sqlite
      .prepare(
        `SELECT s.id as session_id, s.user_id, s.expires_at, u.business_id, u.is_active
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as
      | {
          session_id: string;
          user_id: string;
          expires_at: string;
          business_id: string;
          is_active: number;
        }
      | undefined;

    if (!row || !row.is_active) {
      return null;
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      sqlite.prepare('DELETE FROM user_sessions WHERE id = ?').run(row.session_id);
      return null;
    }

    const roleRows = sqlite
      .prepare('SELECT role, store_id FROM user_roles WHERE user_id = ?')
      .all(row.user_id) as Array<{ role: Role; store_id: string | null }>;

    const defaultStore = sqlite
      .prepare('SELECT id FROM stores WHERE business_id = ? AND is_active = 1 LIMIT 1')
      .get(row.business_id) as { id: string } | undefined;

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      businessId: row.business_id,
      storeId: roleRows.find((r) => r.store_id)?.store_id || defaultStore?.id || '',
      roles: roleRows.map((r) => r.role),
      expiresAt: row.expires_at,
    };
  }

  async revokeSession(token: string): Promise<void> {
    if (!token) return;
    const tokenHash = hashSessionToken(token);
    sqlite.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
  }

  async createEmailVerificationToken(userId: string): Promise<string> {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    sqlite
      .prepare(
        `INSERT INTO email_verification_tokens (id, user_id, token, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), userId, token, expiresAt, new Date().toISOString());
    return token;
  }

  async verifyEmailToken(token: string): Promise<{ userId: string } | null> {
    const row = sqlite
      .prepare('SELECT id, user_id, expires_at, used_at FROM email_verification_tokens WHERE token = ?')
      .get(token) as { id: string; user_id: string; expires_at: string; used_at: string | null } | undefined;

    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      return null;
    }

    const now = new Date().toISOString();
    sqlite.prepare('UPDATE email_verification_tokens SET used_at = ? WHERE id = ?').run(now, row.id);
    sqlite.prepare('UPDATE users SET is_email_verified = 1, updated_at = ? WHERE id = ?').run(now, row.user_id);
    return { userId: row.user_id };
  }

  async createPasswordResetToken(email: string): Promise<string | null> {
    const user = sqlite.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email) as
      | { id: string }
      | undefined;
    if (!user) return null;

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    sqlite
      .prepare(
        `INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), user.id, token, expiresAt, new Date().toISOString());
    return token;
  }

  async resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
    const row = sqlite
      .prepare('SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token = ?')
      .get(token) as { id: string; user_id: string; expires_at: string; used_at: string | null } | undefined;

    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      return false;
    }

    const hash = await this.hashPassword(newPassword);
    const now = new Date().toISOString();
    sqlite.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now, row.id);
    sqlite.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now, row.user_id);
    sqlite.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(row.user_id);
    return true;
  }
}

export const authService = new BcryptCookieAuthService();

export function getUserDTOById(userId: string): AuthUserDTO | null {
  const user = sqlite
    .prepare(
      `SELECT id, business_id, email, phone, full_name, is_email_verified, created_at
       FROM users WHERE id = ? AND is_active = 1`
    )
    .get(userId) as
    | {
        id: string;
        business_id: string;
        email: string;
        phone: string | null;
        full_name: string;
        is_email_verified: number;
        created_at: string;
      }
    | undefined;

  if (!user) return null;

  const roles = sqlite
    .prepare('SELECT role, store_id FROM user_roles WHERE user_id = ?')
    .all(user.id) as Array<{ role: Role; store_id: string | null }>;

  const store = sqlite
    .prepare('SELECT id FROM stores WHERE business_id = ? AND is_active = 1 LIMIT 1')
    .get(user.business_id) as { id: string } | undefined;

  return {
    id: user.id,
    businessId: user.business_id,
    storeId: roles.find((r) => r.store_id)?.store_id || store?.id || '',
    email: user.email,
    phone: user.phone,
    fullName: user.full_name,
    isEmailVerified: Boolean(user.is_email_verified),
    roles: roles.map((r) => r.role),
    createdAt: user.created_at,
  };
}

export interface AuthenticatedRequest extends Request {
  auth?: SessionPayload;
}

export async function attachOptionalAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      const session = await authService.validateSessionToken(token);
      if (session) {
        req.auth = session;
      }
    }
  } catch (err) {
    console.error('Auth middleware error:', err);
  }
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function requireRoles(allowedRoles: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const hasRole = req.auth.roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: 'Forbidden: Insufficient store role permissions' });
      return;
    }
    next();
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
  });
}
