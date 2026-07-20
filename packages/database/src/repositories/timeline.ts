import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Prisma, TimelineEventType } from '../generated/index.js';

const entitySelect = { id: true, title: true, entityType: true } as const;

export interface TimelineEventItem {
  id: string;
  eventType: TimelineEventType;
  description: string;
  metadata: unknown;
  createdAt: Date;
  entity: { id: string; title: string; entityType: string };
}

export interface AppendTimelineEventData {
  organizationId: string;
  entityId: string;
  eventType: TimelineEventType;
  description: string;
  metadata?: Prisma.InputJsonValue;
}

/** Append-only — every entity's timeline is a plain chronological log, never edited or deleted. */
export async function appendTimelineEvent(data: AppendTimelineEventData): Promise<void> {
  await prisma.timelineEvent.create({
    data: {
      organizationId: data.organizationId,
      entityId: data.entityId,
      eventType: data.eventType,
      description: data.description,
      metadata: data.metadata,
    },
  });
}

export interface TimelineQuery {
  organizationId: string;
  page: number;
  pageSize: number;
}

/** One entity's chronological activity feed. */
export async function getTimeline(
  entityId: string,
  query: TimelineQuery,
): Promise<PaginatedResult<TimelineEventItem>> {
  return queryTimeline({ entityId, organizationId: query.organizationId }, query.page, query.pageSize);
}

/** Org-wide activity feed across every entity — backs the global Timeline page. */
export async function getOrganizationTimeline(query: TimelineQuery): Promise<PaginatedResult<TimelineEventItem>> {
  return queryTimeline({ organizationId: query.organizationId }, query.page, query.pageSize);
}

async function queryTimeline(
  where: Prisma.TimelineEventWhereInput,
  page: number,
  pageSize: number,
): Promise<PaginatedResult<TimelineEventItem>> {
  const [items, total] = await Promise.all([
    prisma.timelineEvent.findMany({
      where,
      include: { entity: { select: entitySelect } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.timelineEvent.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
