import { requireRole } from '@bond-os/auth';
import {
  createWebhookDelivery,
  createWebhookSubscription,
  deleteWebhookSubscription,
  getWebhookDelivery,
  getWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  updateWebhookSubscription,
  type WebhookDeliveryRecord,
  type WebhookSubscriptionRecord,
} from '@bond-os/database';
import {
  NotFoundError,
  ROLES,
  ValidationError,
  type CreateWebhookInput,
  type PaginatedResult,
  type UpdateWebhookInput,
} from '@bond-os/shared';

import { requireActiveOrganizationId } from '@/lib/organization';

import { generateWebhookSecret } from '../lib/signing';
import { attemptSingleDelivery, processDueWebhookRetries } from './webhook-dispatch.service';

/**
 * Phase 11 — webhook management (session-authenticated, ADMIN-only). Webhooks
 * are org-level integration config, so every operation requires ADMIN in the
 * active organization and is bound to it — a subscription or delivery in any
 * other org reads as "not found". The signing secret is returned only once,
 * at creation.
 */

export interface WebhookView {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryView {
  id: string;
  subscriptionId: string;
  eventType: string;
  status: WebhookDeliveryRecord['status'];
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

function toView(record: WebhookSubscriptionRecord): WebhookView {
  return {
    id: record.id,
    url: record.url,
    events: record.events,
    description: record.description,
    enabled: record.enabled,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toDeliveryView(record: WebhookDeliveryRecord): WebhookDeliveryView {
  return {
    id: record.id,
    subscriptionId: record.subscriptionId,
    eventType: record.eventType,
    status: record.status,
    attempts: record.attempts,
    responseStatus: record.responseStatus,
    error: record.error,
    nextRetryAt: record.nextRetryAt?.toISOString() ?? null,
    deliveredAt: record.deliveredAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

async function requireAdminOrg(): Promise<string> {
  const organizationId = await requireActiveOrganizationId();
  await requireRole(organizationId, ROLES.ADMIN);
  return organizationId;
}

/** Load a subscription, asserting it belongs to the caller's org. */
async function loadOwned(id: string, organizationId: string): Promise<WebhookSubscriptionRecord> {
  const record = await getWebhookSubscription(id);
  if (!record || record.organizationId !== organizationId) {
    throw new NotFoundError('Webhook not found.');
  }
  return record;
}

export async function listWebhooksService(): Promise<WebhookView[]> {
  const organizationId = await requireAdminOrg();
  const records = await listWebhookSubscriptions(organizationId);
  return records.map(toView);
}

export interface CreatedWebhookResult {
  webhook: WebhookView;
  /** The signing secret — shown exactly once. */
  secret: string;
}

export async function createWebhookService(input: CreateWebhookInput): Promise<CreatedWebhookResult> {
  const organizationId = await requireAdminOrg();
  const session = await requireRole(organizationId, ROLES.ADMIN);
  const secret = generateWebhookSecret();
  const record = await createWebhookSubscription({
    organizationId,
    url: input.url,
    events: input.events,
    secret,
    description: input.description ?? null,
    createdById: session.session.user.id,
  });
  return { webhook: toView(record), secret };
}

export async function updateWebhookService(id: string, input: UpdateWebhookInput): Promise<WebhookView> {
  const organizationId = await requireAdminOrg();
  await loadOwned(id, organizationId);
  const record = await updateWebhookSubscription(id, {
    url: input.url,
    events: input.events,
    description: input.description === undefined ? undefined : input.description,
    enabled: input.enabled,
  });
  return toView(record);
}

export async function deleteWebhookService(id: string): Promise<void> {
  const organizationId = await requireAdminOrg();
  await loadOwned(id, organizationId);
  await deleteWebhookSubscription(id);
}

export async function listWebhookDeliveriesService(params: {
  subscriptionId?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<WebhookDeliveryView>> {
  const organizationId = await requireAdminOrg();
  if (params.subscriptionId) {
    await loadOwned(params.subscriptionId, organizationId);
  }
  const page = await listWebhookDeliveries({ organizationId, ...params });
  return {
    items: page.items.map(toDeliveryView),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: page.totalPages,
  };
}

/**
 * Replay a past delivery: clone its event payload into a fresh delivery row and
 * attempt it immediately. Returns the new delivery's current state.
 */
export async function replayWebhookDeliveryService(deliveryId: string): Promise<WebhookDeliveryView> {
  const organizationId = await requireAdminOrg();
  const original = await getWebhookDelivery(deliveryId);
  if (!original || original.organizationId !== organizationId) {
    throw new NotFoundError('Delivery not found.');
  }
  const subscription = await getWebhookSubscription(original.subscriptionId);
  if (!subscription || subscription.organizationId !== organizationId) {
    throw new ValidationError('The subscription for this delivery no longer exists.');
  }
  const replay = await createWebhookDelivery({
    subscriptionId: original.subscriptionId,
    organizationId,
    eventType: original.eventType,
    eventId: original.eventId,
    payload: (original.payload ?? {}) as Record<string, unknown>,
  });
  await attemptSingleDelivery(replay, subscription);
  const refreshed = await getWebhookDelivery(replay.id);
  return toDeliveryView(refreshed ?? replay);
}

/** Process this organization's due webhook retries (manual/cron-triggerable). */
export async function processWebhookRetriesService(): Promise<{
  processed: number;
  delivered: number;
  retrying: number;
  failed: number;
}> {
  const organizationId = await requireAdminOrg();
  return processDueWebhookRetries(organizationId);
}
