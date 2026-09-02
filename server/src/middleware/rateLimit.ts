import rateLimit from 'express-rate-limit';

/** Generous default for normal API traffic (POS search, reads, etc.). */
export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
});

/** Tighter window for login to slow down credential guessing/enumeration. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Too many attempts. Please try again later.' } }
});

/** More generous than login: legitimate clients call /refresh silently every access-token TTL. */
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'VALIDATION_ERROR', message: 'Too many attempts. Please try again later.' } }
});
