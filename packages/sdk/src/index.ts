/**
 * @bond-os/sdk — the official Extension SDK for BOND OS.
 *
 * - `createClient(config)` — a typed client for the public REST API.
 * - `createEventRouter()` + `EVENT_TYPES` — subscribe to events by type.
 * - `verifyWebhookSignature` / `parseWebhookEvent` — validate inbound webhooks.
 *
 * Zero runtime dependencies: needs only a global `fetch` and Web Crypto.
 */

export { createClient, type BondClient } from './client';
export { HttpClient } from './http';
export * from './types';
export * from './events';
export * from './webhooks';
