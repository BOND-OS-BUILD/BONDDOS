import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Phase 11 — API key material. The public API authenticates with a bearer
 * token of the form `bond_sk_<64 hex chars>`. Only the SHA-256 hash and a
 * short non-secret display prefix are ever persisted; the plaintext is shown
 * to the user exactly once at creation time.
 */

export const API_KEY_PREFIX = 'bond_sk_';
/** Length of the stored display prefix, e.g. `bond_sk_1a2b3c4d`. */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

export interface GeneratedApiKey {
  /** Full secret — returned to the caller once, never stored. */
  plaintext: string;
  /** Non-secret leading slice, safe to persist and display. */
  prefix: string;
  /** SHA-256 hex digest of the plaintext — what we store and look up by. */
  hashedKey: string;
}

/** SHA-256 hex digest of a presented key. Deterministic; used for lookup. */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/** Mint a fresh key: 32 random bytes, hex-encoded, behind the `bond_sk_` prefix. */
export function generateApiKey(): GeneratedApiKey {
  const plaintext = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
    hashedKey: hashApiKey(plaintext),
  };
}

/** Shape check before hashing — cheap rejection of obviously invalid tokens. */
export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX) && token.length === API_KEY_PREFIX.length + 64;
}

/**
 * Extract a bearer token from an `Authorization` header. Accepts
 * `Authorization: Bearer <token>` (case-insensitive scheme). Returns null when
 * absent or malformed rather than throwing — the caller decides the response.
 */
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/** Constant-time hash comparison, guarding the (already indexed) lookup path. */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
