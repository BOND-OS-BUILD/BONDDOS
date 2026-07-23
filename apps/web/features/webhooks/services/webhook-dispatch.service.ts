import {
  createWebhookDelivery,
  listDueWebhookDeliveries,
  listEnabledWebhookSubscriptions,
  updateWebhookDelivery,
  type WebhookDeliveryRecord,
  type WebhookSubscriptionRecord,
} from '@bond-os/database';
import { eventMatchesSubscription, type EventEnvelope } from '@bond-os/shared';
import { logger } from '@bond-os/shared/server';

import {
  signPayload,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
} from '../lib/signing';

const log = logger.child('webhooks');

const MAX_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 3000;
const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_CAP_SECONDS = 6 * 60 * 60;
const MAX_RESPONSE_SNIPPET = 500;

interface EventLike {
  id: string;
  organizationId: string;
  eventType: string;
  payload: unknown;
  createdAt?: Date;
}

function toEnvelope(delivery: WebhookDeliveryRecord): EventEnvelope {
  return {
    id: delivery.eventId ?? delivery.id,
    type: delivery.eventType,
    organizationId: delivery.organizationId,
    occurredAt: delivery.createdAt.toISOString(),
    payload: (delivery.payload as Record<string, unknown>) ?? {},
  };
}

function nextRetryDelaySeconds(attempts: number): number {
  return Math.min(BACKOFF_BASE_SECONDS * 2 ** (attempts - 1), BACKOFF_CAP_SECONDS);
}

/**
 * Attempt a single delivery and persist the outcome. `attempts` is incremented
 * for this try; on failure below the cap the row becomes RETRYING with a
 * back-off `nextRetryAt`, at/above the cap it becomes FAILED. Never throws.
 */
async function runDelivery(
  delivery: WebhookDeliveryRecord,
  subscription: WebhookSubscriptionRecord,
): Promise<'delivered' | 'retrying' | 'failed'> {
  const attempts = delivery.attempts + 1;
  const body = JSON.stringify(toEnvelope(delivery));
  const timestamp = Math.floor(Date.now() / 1000);
  const { header } = signPayload(subscription.secret, body, timestamp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: header,
        [WEBHOOK_EVENT_HEADER]: delivery.eventType,
        [WEBHOOK_DELIVERY_HEADER]: delivery.id,
        'user-agent': 'BondOS-Webhooks/1.0',
      },
      body,
      signal: controller.signal,
    });

    const snippet = (await response.text().catch(() => '')).slice(0, MAX_RESPONSE_SNIPPET);
    if (response.ok) {
      await updateWebhookDelivery(delivery.id, {
        status: 'DELIVERED',
        attempts,
        responseStatus: response.status,
        responseBody: snippet,
        deliveredAt: new Date(),
      });
      return 'delivered';
    }
    return scheduleRetryOrFail(delivery.id, attempts, response.status, snippet, `HTTP ${response.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return scheduleRetryOrFail(delivery.id, attempts, null, null, message);
  } finally {
    clearTimeout(timer);
  }
}

async function scheduleRetryOrFail(
  id: string,
  attempts: number,
  responseStatus: number | null,
  responseBody: string | null,
  error: string,
): Promise<'retrying' | 'failed'> {
  if (attempts >= MAX_ATTEMPTS) {
    await updateWebhookDelivery(id, { status: 'FAILED', attempts, responseStatus, responseBody, error });
    return 'failed';
  }
  const nextRetryAt = new Date(Date.now() + nextRetryDelaySeconds(attempts) * 1000);
  await updateWebhookDelivery(id, { status: 'RETRYING', attempts, responseStatus, responseBody, error, nextRetryAt });
  return 'retrying';
}

/**
 * Fan an event out to every enabled, matching subscription: create a delivery
 * row per subscription then attempt them concurrently. Best-effort — any
 * failure is logged and swallowed so publishing an event can never break the
 * caller (same contract as the notification/workflow fan-out).
 */
export async function dispatchEventToWebhooks(event: EventLike): Promise<void> {
  const subscriptions = await listEnabledWebhookSubscriptions(event.organizationId);
  const matching = subscriptions.filter((sub) => eventMatchesSubscription(event.eventType, sub.events));
  if (matching.length === 0) return;

  await Promise.allSettled(
    matching.map(async (subscription) => {
      const delivery = await createWebhookDelivery({
        subscriptionId: subscription.id,
        organizationId: event.organizationId,
        eventType: event.eventType,
        eventId: event.id,
        payload: (event.payload ?? {}) as Record<string, unknown>,
      });
      await runDelivery(delivery, subscription);
    }),
  ).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      log.error('Webhook dispatch had failures', {
        eventId: event.id,
        organizationId: event.organizationId,
        eventType: event.eventType,
        failed: failed.length,
      });
    }
  });
}

/**
 * Retry all deliveries due for another attempt in an organization. Triggered
 * by `POST /api/webhooks/process-retries` (there is no background worker; this
 * mirrors the embeddings-jobs retry endpoint). Returns a small summary.
 */
export async function processDueWebhookRetries(
  organizationId: string,
  limit = 50,
): Promise<{ processed: number; delivered: number; retrying: number; failed: number }> {
  const due = await listDueWebhookDeliveries(organizationId, new Date(), limit);
  if (due.length === 0) return { processed: 0, delivered: 0, retrying: 0, failed: 0 };

  const subscriptions = await listEnabledWebhookSubscriptions(organizationId);
  const byId = new Map(subscriptions.map((sub) => [sub.id, sub]));

  let delivered = 0;
  let retrying = 0;
  let failed = 0;
  for (const delivery of due) {
    const subscription = byId.get(delivery.subscriptionId);
    if (!subscription) {
      // Subscription was disabled/deleted — abandon the delivery.
      await updateWebhookDelivery(delivery.id, {
        status: 'FAILED',
        attempts: delivery.attempts,
        error: 'Subscription no longer active.',
      });
      failed += 1;
      continue;
    }
    const outcome = await runDelivery(delivery, subscription);
    if (outcome === 'delivered') delivered += 1;
    else if (outcome === 'retrying') retrying += 1;
    else failed += 1;
  }
  return { processed: due.length, delivered, retrying, failed };
}

/** Re-run a specific delivery immediately (used by replay). Never throws. */
export async function attemptSingleDelivery(
  delivery: WebhookDeliveryRecord,
  subscription: WebhookSubscriptionRecord,
): Promise<'delivered' | 'retrying' | 'failed'> {
  return runDelivery(delivery, subscription);
}
