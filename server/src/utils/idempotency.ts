import crypto from 'crypto';

/** Deterministic across key order so semantically-identical retries hash the same. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function hashPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(sortKeysDeep(payload))).digest('hex');
}
