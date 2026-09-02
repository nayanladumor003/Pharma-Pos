import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../errors/AppError';

export const JWT_ISSUER = 'pharmapos-api';
export const JWT_AUDIENCE = 'pharmapos-client';

interface AccessTokenPayload {
  sub: string;
  type: 'access';
}

interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  /** Refresh-token DB record id — how the server-side session is looked up for rotation/revocation. */
  jti: string;
}

export function signAccessToken(userId: string): string {
  const payload: AccessTokenPayload = { sub: userId, type: 'access' };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  } as jwt.SignOptions);
}

export function signRefreshToken(userId: string, tokenRecordId: string): string {
  const payload: RefreshTokenPayload = { sub: userId, type: 'refresh', jti: tokenRecordId };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE
  } as jwt.SignOptions);
}

/**
 * Verifies signature + expiry + issuer/audience with the ACCESS secret, then
 * explicitly rejects anything that isn't type:'access' — defense in depth so a
 * refresh token can never be replayed as an access token even if secrets were
 * ever misconfigured to be equal.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  if (typeof decoded === 'string' || decoded.type !== 'access' || typeof decoded.sub !== 'string') {
    throw AppError.unauthorized('Invalid access token');
  }
  return { sub: decoded.sub, type: 'access' };
}

/** Same defense-in-depth pattern in the other direction: rejects a presented access token. */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  if (
    typeof decoded === 'string' ||
    decoded.type !== 'refresh' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.jti !== 'string'
  ) {
    throw AppError.unauthorized('Invalid refresh token');
  }
  return { sub: decoded.sub, type: 'refresh', jti: decoded.jti };
}
