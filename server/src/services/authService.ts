import crypto from 'crypto';
import { Types } from 'mongoose';
import { User } from '../models/User.model';
import { Employee } from '../models/Employee.model';
import { RefreshToken } from '../models/RefreshToken.model';
import { AppError } from '../errors/AppError';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { durationToMs } from '../utils/duration';
import { env } from '../config/env';
import { auditLog } from '../utils/auditLog';

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface AuthContext {
  userId: string;
  employeeId: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

interface EmployeeLean {
  _id: Types.ObjectId;
  name: string;
  role: string;
  status: string;
  permissions: string[];
}

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const GENERIC_LOGIN_ERROR = 'Invalid email or password';
const GENERIC_SESSION_ERROR = 'Session expired — please log in again';

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function toAuthContext(user: { _id: Types.ObjectId; email: string }, employee: EmployeeLean): AuthContext {
  return {
    userId: user._id.toString(),
    employeeId: employee._id.toString(),
    email: user.email,
    name: employee.name,
    role: employee.role,
    permissions: employee.permissions
  };
}

/** Pre-generates the session record id so it can be embedded as the refresh JWT's `jti`
 *  in the same insert — avoids a placeholder-then-update race under concurrent logins. */
async function issueSession(
  userId: Types.ObjectId,
  meta: SessionMeta
): Promise<SessionTokens & { tokenRecordId: Types.ObjectId }> {
  const tokenRecordId = new Types.ObjectId();
  const refreshToken = signRefreshToken(userId.toString(), tokenRecordId.toString());
  const refreshExpiresAt = new Date(Date.now() + durationToMs(env.JWT_REFRESH_EXPIRES_IN));

  await RefreshToken.create({
    _id: tokenRecordId,
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: refreshExpiresAt,
    userAgent: meta.userAgent,
    ipAddress: meta.ipAddress
  });

  const accessToken = signAccessToken(userId.toString());
  return { accessToken, refreshToken, refreshExpiresAt, tokenRecordId };
}

export async function login(
  email: string,
  password: string,
  meta: SessionMeta
): Promise<SessionTokens & { user: AuthContext }> {
  const user = await User.findOne({ email }).select('+passwordHash').populate<{ employeeId: EmployeeLean }>(
    'employeeId'
  );

  // Always run exactly one bcrypt compare (real or decoy) before branching, so a
  // nonexistent email, a wrong password, and an inactive account all take
  // approximately the same time to fail — no timing-based user enumeration.
  const passwordValid = user
    ? await verifyPassword(password, user.get('passwordHash'))
    : await verifyPassword(password, DUMMY_PASSWORD_HASH).then(() => false);

  const employee = user?.employeeId;
  const accountUsable = Boolean(user && user.isActive && employee && employee.status === 'Active');

  if (!user || !passwordValid || !accountUsable) {
    auditLog('login_failed', {
      email,
      reason: !user ? 'user_not_found' : !passwordValid ? 'wrong_password' : 'inactive',
      userId: user?._id.toString()
    });
    // Same generic message and error code regardless of which case above fired —
    // never reveal whether the email exists, the account is disabled, or the
    // password was wrong.
    throw AppError.unauthorized(GENERIC_LOGIN_ERROR);
  }

  const tokens = await issueSession(user._id, meta);
  user.lastLoginAt = new Date();
  await user.save();

  auditLog('login_success', { email, userId: user._id.toString() });

  return { ...tokens, user: toAuthContext(user, employee as EmployeeLean) };
}

export async function refresh(
  rawRefreshToken: string,
  meta: SessionMeta
): Promise<SessionTokens & { user: AuthContext }> {
  let payload: { sub: string; jti: string };
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    auditLog('refresh_failed', { reason: 'invalid_token' });
    throw AppError.unauthorized(GENERIC_SESSION_ERROR);
  }

  const record = await RefreshToken.findById(payload.jti);
  if (!record || hashToken(rawRefreshToken) !== record.tokenHash) {
    auditLog('refresh_failed', { reason: 'not_found_or_mismatch', userId: payload.sub });
    throw AppError.unauthorized(GENERIC_SESSION_ERROR);
  }

  if (record.revokedAt) {
    // A refresh token that was already rotated away is being replayed — that's
    // a signal of theft/duplication, not a legitimate retry. Kill every
    // outstanding session for this user rather than trusting this one token.
    await revokeAllSessions(record.userId.toString());
    auditLog('refresh_reuse_detected', { userId: record.userId.toString() });
    throw AppError.unauthorized(GENERIC_SESSION_ERROR);
  }

  if (record.expiresAt.getTime() < Date.now()) {
    auditLog('refresh_failed', { reason: 'expired', userId: record.userId.toString() });
    throw AppError.unauthorized(GENERIC_SESSION_ERROR);
  }

  const user = await User.findById(record.userId).populate<{ employeeId: EmployeeLean }>('employeeId');
  const employee = user?.employeeId;
  if (!user || !user.isActive || !employee || employee.status !== 'Active') {
    record.revokedAt = new Date();
    await record.save();
    auditLog('refresh_failed', { reason: 'inactive', userId: record.userId.toString() });
    throw AppError.unauthorized(GENERIC_SESSION_ERROR);
  }

  const newTokens = await issueSession(user._id, meta);
  record.revokedAt = new Date();
  record.replacedByTokenId = newTokens.tokenRecordId;
  await record.save();

  auditLog('refresh_success', { userId: user._id.toString() });

  return { ...newTokens, user: toAuthContext(user, employee) };
}

export async function logout(rawRefreshToken: string | undefined): Promise<void> {
  if (!rawRefreshToken) return;
  try {
    const payload = verifyRefreshToken(rawRefreshToken);
    const record = await RefreshToken.findById(payload.jti);
    if (record && !record.revokedAt) {
      record.revokedAt = new Date();
      await record.save();
      auditLog('logout', { userId: payload.sub });
    }
  } catch {
    // Invalid/expired token presented at logout — nothing to revoke.
    // Logout is idempotent from the client's point of view either way.
  }
}

/** Revokes every outstanding session for a user — used on reuse-detection and
 *  available for a future "deactivate employee" admin action to call proactively. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}

/**
 * Loads the current, authoritative auth context for an already-verified access
 * token's subject. Deliberately re-reads User+Employee from the DB on every
 * call instead of trusting JWT claims, so permission changes and employee
 * deactivation take effect on the very next request rather than waiting up to
 * the access token's natural expiry.
 */
export async function loadAuthContext(userId: string): Promise<AuthContext | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const user = await User.findById(userId).populate<{ employeeId: EmployeeLean }>('employeeId');
  if (!user || !user.isActive) return null;
  const employee = user.employeeId;
  if (!employee || employee.status !== 'Active') return null;
  return toAuthContext(user, employee);
}

// Referenced so the Employee model is registered before populate('employeeId') runs
// even in an entrypoint that never imports Employee.model directly.
void Employee;
