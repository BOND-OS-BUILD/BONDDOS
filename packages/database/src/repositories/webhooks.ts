import type { Prisma, WebhookDeliveryStatus } from '../generated';
import { prisma } from '../client';

/**
 * Phase 11 — outbound webhook persistence. A `WebhookSubscription` is an
 * org-scoped endpoint + event filter + signing secret. Each attempt to notify
 * it is a `WebhookDelivery` row carrying status, attempt count, and the next
 * retry time — the durable log that powers delivery history and replay.
 */

// ── Subscriptions ──────────────────────────────────────────────────────────

export interface WebhookSubscriptionRecord {
  id: string;
  organizationId: string;
  url: string;
  events: string[];
  secret: string;
  description: string | null;
  enabled: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWebhookSubscriptionData {
  organizationId: string;
  url: string;
  events: string[];
  secret: string;
  description?: string | null;
  createdById?: string | null;
}

export function createWebhookSubscription(
  data: CreateWebhookSubscriptionData,
): Promise<WebhookSubscriptionRecord> {
  return prisma.webhookSubscription.create({
    data: {
      organizationId: data.organizationId,
      url: data.url,
      events: data.events,
      secret: data.secret,
      description: data.description ?? null,
      createdById: data.createdById ?? null,
    },
  });
}

export function listWebhookSubscriptions(organizationId: string): Promise<WebhookSubscriptionRecord[]> {
  return prisma.webhookSubscription.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
}

/** Enabled subscriptions only — the set the dispatcher fans an event out to. */
export function listEnabledWebhookSubscriptions(organizationId: string): Promise<WebhookSubscriptionRecord[]> {
  return prisma.webhookSubscription.findMany({
    where: { organizationId, enabled: true },
  });
}

export function getWebhookSubscription(id: string): Promise<WebhookSubscriptionRecord | null> {
  return prisma.webhookSubscription.findUnique({ where: { id } });
}

export interface UpdateWebhookSubscriptionData {
  url?: string;
  events?: string[];
  description?: string | null;
  enabled?: boolean;
}

export function updateWebhookSubscription(
  id: string,
  data: UpdateWebhookSubscriptionData,
): Promise<WebhookSubscriptionRecord> {
  return prisma.webhookSubscription.update({
    where: { id },
    data: {
      url: data.url,
      events: data.events,
      description: data.description,
      enabled: data.enabled,
    },
  });
}

export async function deleteWebhookSubscription(id: string): Promise<void> {
  await prisma.webhookSubscription.delete({ where: { id } });
}

// ── Deliveries ─────────────────────────────────────────────────────────────

export interface WebhookDeliveryRecord {
  id: string;
  subscriptionId: string;
  organizationId: string;
  eventType: string;
  eventId: string | null;
  payload: Prisma.JsonValue;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface CreateWebhookDeliveryData {
  subscriptionId: string;
  organizationId: string;
  eventType: string;
  eventId?: string | null;
  /** Arbitrary JSON event payload; cast to Prisma's JSON input type here. */
  payload: unknown;
}

export function createWebhookDelivery(data: CreateWebhookDeliveryData): Promise<WebhookDeliveryRecord> {
  return prisma.webhookDelivery.create({
    data: {
      subscriptionId: data.subscriptionId,
      organizationId: data.organizationId,
      eventType: data.eventType,
      eventId: data.eventId ?? null,
      payload: (data.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export interface UpdateWebhookDeliveryData {
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus?: number | null;
  responseBody?: string | null;
  error?: string | null;
  nextRetryAt?: Date | null;
  deliveredAt?: Date | null;
}

export function updateWebhookDelivery(
  id: string,
  data: UpdateWebhookDeliveryData,
): Promise<WebhookDeliveryRecord> {
  return prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: data.status,
      attempts: data.attempts,
      responseStatus: data.responseStatus ?? null,
      responseBody: data.responseBody ?? null,
      error: data.error ?? null,
      nextRetryAt: data.nextRetryAt ?? null,
      deliveredAt: data.deliveredAt ?? null,
    },
  });
}

export function getWebhookDelivery(id: string): Promise<WebhookDeliveryRecord | null> {
  return prisma.webhookDelivery.findUnique({ where: { id } });
}

export interface WebhookDeliveryPage {
  items: WebhookDeliveryRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listWebhookDeliveries(params: {
  organizationId: string;
  subscriptionId?: string;
  page?: number;
  pageSize?: number;
}): Promise<WebhookDeliveryPage> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.WebhookDeliveryWhereInput = {
    organizationId: params.organizationId,
    ...(params.subscriptionId ? { subscriptionId: params.subscriptionId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.webhookDelivery.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Deliveries due for another attempt (status RETRYING/PENDING, retry time passed). */
export function listDueWebhookDeliveries(organizationId: string, now: Date, limit = 50): Promise<WebhookDeliveryRecord[]> {
  return prisma.webhookDelivery.findMany({
    where: {
      organizationId,
      status: { in: ['PENDING', 'RETRYING'] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(200, Math.max(1, limit)),
  });
}
