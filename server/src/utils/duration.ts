/** Parses a short duration string ('15m', '7d', '30s', '2h') into milliseconds. */
export function durationToMs(input: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/i.exec(input.trim());
  if (!match) throw new Error(`Invalid duration string: "${input}"`);
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * unitMs[unit];
}
