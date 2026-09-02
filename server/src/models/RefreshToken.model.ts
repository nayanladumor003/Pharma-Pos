import { Schema, model } from 'mongoose';
import { toJSONPlugin } from './shared/toJSON.plugin';

/**
 * Server-side refresh-token session record — what makes refresh tokens
 * actually revocable instead of "valid until they expire no matter what".
 *
 * Only a SHA-256 hash of the issued JWT is stored, never the raw token
 * (mirrors password-hash hygiene: a DB read/leak can't be replayed as a
 * usable session). Rotation-with-reuse-detection (OWASP-recommended pattern):
 * every successful /refresh revokes the presented token and issues a new one
 * chained via replacedByTokenId. If a token is presented AFTER it was already
 * revoked, that's a replay of a stolen/duplicated token — the auth service
 * responds by revoking every other outstanding token for that user.
 *
 * expiresAt carries a Mongo TTL index so spent/expired records are pruned
 * automatically without a cleanup job.
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenId: { type: Schema.Types.ObjectId, ref: 'RefreshToken', default: null },
    userAgent: { type: String },
    ipAddress: { type: String }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

refreshTokenSchema.index({ userId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

toJSONPlugin(refreshTokenSchema);

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
