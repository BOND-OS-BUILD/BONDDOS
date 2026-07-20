import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison for secret verification (Phase 8's tick
 * endpoint and webhook signatures) — no precedent for this exists anywhere
 * else in this codebase, so specified explicitly rather than left to a
 * plain `===` (timing side-channel) or an unguarded `timingSafeEqual`
 * (throws on length mismatch, which itself leaks length via a thrown
 * exception vs a clean `false` — checked first here to fail closed
 * uniformly regardless of length).
 */
export function secureCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
