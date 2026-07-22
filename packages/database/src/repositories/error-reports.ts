import type { Prisma } from '../generated';
import { prisma } from '../client';

/**
 * Phase 10 — error reporting with grouping. Each unique fingerprint is one
 * ErrorGroup (roll-up: count / first-/last-seen / resolved); every occurrence
 * is an ErrorEvent carrying the full request/user/org/stack/route/browser
 * context. A recurrence re-opens a resolved group.
 */

export interface RecordErrorInput {
  fingerprint: string;
  title: string;
  message: string;
  level?: string;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  requestId?: string | null;
  correlationId?: string | null;
  userId?: string | null;
  organizationId?: string | null;
  url?: string | null;
  userAgent?: string | null;
  stack?: string | null;
}

export async function recordError(input: RecordErrorInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const group = await tx.errorGroup.upsert({
      where: { fingerprint: input.fingerprint },
      create: {
        fingerprint: input.fingerprint,
        title: input.title.slice(0, 300),
        message: input.message.slice(0, 2000),
        level: input.level ?? 'error',
        count: 1,
        lastRoute: input.route ?? null,
        lastStatusCode: input.statusCode ?? null,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        message: input.message.slice(0, 2000),
        lastRoute: input.route ?? undefined,
        lastStatusCode: input.statusCode ?? undefined,
        resolved: false,
      },
    });
    await tx.errorEvent.create({
      data: {
        groupId: group.id,
        message: input.message.slice(0, 2000),
        stack: input.stack ?? null,
        route: input.route ?? null,
        method: input.method ?? null,
        statusCode: input.statusCode ?? null,
        requestId: input.requestId ?? null,
        correlationId: input.correlationId ?? null,
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        url: input.url ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  });
}

export interface ErrorGroupRecord {
  id: string;
  fingerprint: string;
  title: string;
  message: string;
  level: string;
  count: number;
  resolved: boolean;
  lastRoute: string | null;
  lastStatusCode: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface ErrorGroupPage {
  items: ErrorGroupRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listErrorGroups(params: {
  resolved?: boolean;
  page?: number;
  pageSize?: number;
} = {}): Promise<ErrorGroupPage> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.ErrorGroupWhereInput =
    params.resolved === undefined ? {} : { resolved: params.resolved };
  const [items, total] = await Promise.all([
    prisma.errorGroup.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.errorGroup.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getErrorGroupWithEvents(id: string, eventLimit = 20) {
  const group = await prisma.errorGroup.findUnique({ where: { id } });
  if (!group) return null;
  const events = await prisma.errorEvent.findMany({
    where: { groupId: id },
    orderBy: { createdAt: 'desc' },
    take: eventLimit,
  });
  return { group, events };
}

export async function setErrorGroupResolved(id: string, resolved: boolean): Promise<void> {
  await prisma.errorGroup.update({ where: { id }, data: { resolved } });
}

export async function getErrorStats(since: Date): Promise<{
  totalGroups: number;
  unresolved: number;
  eventsInWindow: number;
}> {
  const [totalGroups, unresolved, eventsInWindow] = await Promise.all([
    prisma.errorGroup.count(),
    prisma.errorGroup.count({ where: { resolved: false } }),
    prisma.errorEvent.count({ where: { createdAt: { gte: since } } }),
  ]);
  return { totalGroups, unresolved, eventsInWindow };
}
