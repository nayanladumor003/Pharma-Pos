import bcrypt from 'bcryptjs';

// Cost factor 12: a modern, deliberate choice — meaningfully stronger than the
// old default of 10 without making login latency noticeable at pharmacy-POS scale.
const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}

// A precomputed hash of a random, never-used value. When login fails because no
// user/passwordHash exists, we still run a compare against this so the response
// time doesn't leak "this email doesn't exist" via a faster failure path
// (timing-based user enumeration) — see authService.login.
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync('this-hash-is-intentionally-unreachable', SALT_ROUNDS);
