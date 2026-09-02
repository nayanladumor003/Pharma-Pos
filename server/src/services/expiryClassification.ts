const DAY_MS = 24 * 3600 * 1000;

export type ExpiryTier = 'Expired' | 'Critical' | 'Near' | 'Watchlist' | 'Healthy';

/**
 * BUSINESS_RULES.md Rule 1.3 — fixed, non-configurable day boundaries (0/7/30/90).
 * These are NOT derived from InventorySettings.expiryWarningDays/criticalExpiryDays
 * (which drive separate dashboard threshold UI elsewhere) — the task explicitly
 * says not to invent different thresholds here.
 */
export function classifyExpiry(expiryDate: Date, now: Date = new Date()): { tier: ExpiryTier; daysRemaining: number } {
  const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / DAY_MS);
  if (daysRemaining <= 0) return { tier: 'Expired', daysRemaining };
  if (daysRemaining <= 7) return { tier: 'Critical', daysRemaining };
  if (daysRemaining <= 30) return { tier: 'Near', daysRemaining };
  if (daysRemaining <= 90) return { tier: 'Watchlist', daysRemaining };
  return { tier: 'Healthy', daysRemaining };
}

/**
 * Date-range bounds for each tier, expressed as exact Date comparisons
 * (`lower < expiryDate <= upper`) rather than a day-count comparison — this is
 * provably equivalent to classifyExpiry's ceil-based day count for filtering
 * purposes, and matches the raw-millisecond-division style the existing
 * InventoryPage.tsx near-expiry filter already uses, so query results and the
 * classification shown alongside them can never disagree at a tier boundary.
 */
export function expiryTierBounds(tier: 'critical' | 'near' | 'watchlist' | 'all', now: Date = new Date()) {
  const at = (days: number) => new Date(now.getTime() + days * DAY_MS);
  const ranges: Record<typeof tier, [Date, Date]> = {
    critical: [now, at(7)],
    near: [at(7), at(30)],
    watchlist: [at(30), at(90)],
    all: [now, at(90)]
  };
  const [lower, upper] = ranges[tier];
  return { lower, upper };
}
