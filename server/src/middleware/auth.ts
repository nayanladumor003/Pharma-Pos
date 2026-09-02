import { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/AppError';
import { verifyAccessToken } from '../utils/jwt';
import { loadAuthContext } from '../services/authService';

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies the access token (Authorization header only — the refresh token,
 * not this one, lives in the httpOnly cookie and is never read here), then
 * re-loads the user/employee from the DB so permission and active-status
 * changes take effect immediately rather than waiting out the token's TTL.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const context = await loadAuthContext(payload.sub);
    if (!context) {
      next(AppError.unauthorized('Your session is no longer valid — please log in again'));
      return;
    }
    req.user = context;
    next();
  } catch (err) {
    next(err);
  }
}
