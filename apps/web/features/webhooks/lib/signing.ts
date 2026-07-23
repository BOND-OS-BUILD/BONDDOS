import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Phase 11 — webhook payload signing. Every delivery carries an
 * `X-BondOS-Signature: t=<unix>,v1=<hex>` header. The signature is
 * HMAC-SHA256 over `"<timestamp>.<rawBody>"` keyed by the subscription's
 * secret, so a receiver can (a) verify the payload came from BOND OS and
 * (b) reject stale/replayed requests via the timestamp. Mirrors the scheme
 * documented for consumers in docs/webhooks.md.
 */

export const WEBHOOK_SIGNATURE_HEADER = 'X-BondOS-Signature';
export const WEBHOOK_EVENT_HEADER = 'X-BondOS-Event';
export const WEBHOOK_DELIVERY_HEADER = 'X-BondOS-Delivery';

/** Mint a subscription signing secret. Shown to the caller once at creation. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

export interface SignedPayload {
  header: string;
  timestamp: number;
}

/** Compute the signature header for a raw JSON body at the given time (unix seconds). */
export function signPayload(secret: string, body: string, timestampSeconds: number): SignedPayload {
  const signature = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex');
  return { header: `t=${timestampSeconds},v1=${signature}`, timestamp: timestampSeconds };
}

function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  const parts = Object.fromEntries(
    header.split(',').map((segment) => {
      const [key, value] = segment.split('=');
      return [key?.trim(), value?.trim()];
    }),
  );
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t)) return null;
  return { t, v1: parts.v1 };
}

/**
 * Verify a received signature (provided for the SDK/consumers and tests).
 * Rejects when the timestamp is older than `toleranceSeconds` (default 5 min).
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowSeconds - parsed.t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${parsed.t}.${body}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parsed.v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
