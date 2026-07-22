import type { Prisma, SecurityEventType } from '../generated';
import { prisma } from '../client';

/**
 * Phase 10 — security event persistence backing the Security Dashboard and
 * the Admin Console. Populated centrally at the API error boundary (auth /
 * permission / rate-limit failures) plus a few explicit hooks. Org/user are
 * nullable because some events (failed logins, cross-org probes) have no
 * trusted context.
 */

export interface SecurityEventRecord {
  id: string;
  type: SecurityEventType;
  userId: string | null;
  organizationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  route: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}

export interface CreateSecurityEventInput {
  type: SecurityEventType;
  userId?: string | null;
  organizationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  route?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function createSecurityEvent(input: CreateSecurityEventInput): Promise<SecurityEventRecord> {
  return prisma.securityEvent.create({
    data: {
      type: input.type,
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      route: input.route ?? null,
      metadata: input.metadata,
    },
  });
}

export interface ListSecurityEventsFilters {
  organizationId?: string;
  type?: SecurityEventType;
  since?: Date;
  page?: number;
  pageSize?: number;
}

export interface SecurityEventPage {
  items: SecurityEventRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listSecurityEvents(filters: ListSecurityEventsFilters = {}): Promise<SecurityEventPage> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const where: Prisma.SecurityEventWhereInput = {
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.securityEvent.count({ where }),
  ]);
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface SecurityEventStat {
  type: SecurityEventType;
  count: number;
}

export async function getSecurityEventStats(params: {
  organizationId?: string;
  since: Date;
}): Promise<{ byType: SecurityEventStat[]; total: number }> {
  const where: Prisma.SecurityEventWhereInput = {
    ...(params.organizationId ? { organizationId: params.organizationId } : {}),
    createdAt: { gte: params.since },
  };
  const grouped = await prisma.securityEvent.groupBy({
    by: ['type'],
    where,
    _count: { _all: true },
  });
  const byType = grouped.map((row) => ({ type: row.type, count: row._count._all }));
  return { byType, total: byType.reduce((sum, row) => sum + row.count, 0) };
}
