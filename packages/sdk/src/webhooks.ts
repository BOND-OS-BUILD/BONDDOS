import type { EventEnvelope } from './events';

/**
 * Webhook signature verification for receivers. Isomorphic — uses Web Crypto
 * (`globalThis.crypto.subtle`), available in Node 18+, Deno, Bun, browsers and
 * edge runtimes. The server signs `"<timestamp>.<rawBody>"` with HMAC-SHA256
 * and sends `X-BondOS-Signature: t=<unix>,v1=<hex>`.
 */

export const WEBHOOK_SIGNATURE_HEADER = 'x-bondos-signature';
export const WEBHOOK_EVENT_HEADER = 'x-bondos-event';
export const WEBHOOK_DELIVERY_HEADER = 'x-bondos-delivery';

const DEFAULT_TOLERANCE_SECONDS = 300;

function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  const parts: Record<string, string> = {};
  for (const segment of header.split(',')) {
    const [key, value] = segment.split('=');
    if (key && value) parts[key.trim()] = value.trim();
  }
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t)) return null;
  return { t, v1: parts.v1 };
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('BOND OS SDK: Web Crypto (crypto.subtle) is not available in this runtime.');
  const encoder = new TextEncoder();
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(signature);
}

export interface VerifyWebhookOptions {
  /** The subscription's signing secret (`whsec_…`). */
  secret: string;
  /** The exact raw request body string (do not re-serialize the parsed JSON). */
  body: string;
  /** The `X-BondOS-Signature` header value. */
  signatureHeader: string | null | undefined;
  /** Reject signatures older than this many seconds (default 300). */
  toleranceSeconds?: number;
  /** Current time in unix seconds (override for tests). */
  nowSeconds?: number;
}

/** Verify a webhook signature. Returns true only for a fresh, valid signature. */
export async function verifyWebhookSignature(options: VerifyWebhookOptions): Promise<boolean> {
  if (!options.signatureHeader) return false;
  const parsed = parseSignatureHeader(options.signatureHeader);
  if (!parsed) return false;

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - parsed.t) > tolerance) return false;

  const expected = await hmacSha256Hex(options.secret, `${parsed.t}.${options.body}`);
  return timingSafeEqualHex(expected, parsed.v1);
}

/**
 * Verify + parse a received webhook into a typed `EventEnvelope`. Throws if the
 * signature is invalid or stale — so a handler only ever sees authentic events.
 */
export async function parseWebhookEvent(options: VerifyWebhookOptions): Promise<EventEnvelope> {
  const valid = await verifyWebhookSignature(options);
  if (!valid) throw new Error('BOND OS SDK: invalid or expired webhook signature.');
  return JSON.parse(options.body) as EventEnvelope;
}
