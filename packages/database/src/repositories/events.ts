import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { EventSource, Prisma } from '../generated/index.js';

/** The Event Bus's append-only envelope (Phase 8) — never edited or deleted, same convention as `AuditEvent`/`AgentTimelineEvent`. See docs/event-bus.md. */

export interface EventData {
  id: string;
  organizationId: string;
  eventType: string;
  source: EventSource;
  payload: unknown;
  correlationId: string;
  causationId: string | null;
  metadata: unknown;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
}

export interface CreateEventData {
  organizationId: string;
  eventType: string;
  source: EventSource;
  payload: Prisma.InputJsonValue;
  correlationId: string;
  causationId?: string | null;
  metadata?: Prisma.InputJsonValue;
  entityType?: string;
  entityId?: string;
}

export async function createEvent(data: CreateEventData): Promise<EventData> {
  return prisma.event.create({ data });
}

export async function getEventById(id: string, organizationId: string): Promise<EventData | null> {
  return prisma.event.findFirst({ where: { id, organizationId } });
}

export interface ListEventsFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  eventType?: string;
  source?: EventSource;
  /** Phase 9 Activity Feed filter — both must be provided together (an entity is identified by the pair, not `entityId` alone). */
  entityType?: string;
  entityId?: string;
}

export async function listEvents(filters: ListEventsFilters): Promise<PaginatedResult<EventData>> {
  const { organizationId, page, pageSize, eventType, source, entityType, entityId } = filters;
  const where = {
    organizationId,
    ...(eventType && { eventType }),
    ...(source && { source }),
    ...(entityType && entityId && { entityType, entityId }),
  };

  const [items, total] = await Promise.all([
    prisma.event.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.event.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
