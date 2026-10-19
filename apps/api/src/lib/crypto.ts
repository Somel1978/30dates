import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Deterministic pair identifier: HMAC-SHA256(min(uuidA, uuidB) || max(uuidA, uuidB), salt).
 * Canonical lowercase UUID strings sort in the same order as PostgreSQL's uuid type.
 */
export function pairHash(userA: string, userB: string, salt: string): Buffer {
  const [lo, hi] = orderedPair(userA, userB);
  return createHmac('sha256', salt).update(lo + hi).digest();
}

export function orderedPair(userA: string, userB: string): [string, string] {
  const a = userA.toLowerCase();
  const b = userB.toLowerCase();
  if (a === b) throw new Error('pair_requires_distinct_users');
  return a < b ? [a, b] : [b, a];
}

export function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
