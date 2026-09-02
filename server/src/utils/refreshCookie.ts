import { CookieOptions, Response } from 'express';
import { env } from '../config/env';

export const REFRESH_COOKIE_NAME = 'refreshToken';

// httpOnly: never readable by JS (mitigates XSS token theft). secure: only sent
// over HTTPS in production (dev runs over plain http://localhost). sameSite:
// 'lax' is the standard baseline CSRF mitigation for an auth cookie that still
// needs to survive a normal top-level navigation/reload. path scoped to
// /api/auth so the cookie is never even transmitted to unrelated API routes.
function cookieOptions(maxAge?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge
  };
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, cookieOptions(expiresAt.getTime() - Date.now()));
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions());
}
