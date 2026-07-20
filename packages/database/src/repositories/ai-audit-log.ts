import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Prisma } from '../generated/index.js';

/** Audit trail for AI-related requests (Security §15) — fire-and-forget, never blocks the caller. See docs/retrieval.md. */

export interface LogAiRequestData {
  organizationId: string;
  userId?: string | null;
  action: string;
  provider?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function logAiRequest(data: LogAiRequestData): Promise<void> {
  await prisma.aiAuditLog.create({ data });
}

export interface AiAuditLogItem {
  id: string;
  userId: string | null;
  action: string;
  provider: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface AiAuditLogFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  action?: string;
}

export async function listAiAuditLogs(filters: AiAuditLogFilters): Promise<PaginatedResult<AiAuditLogItem>> {
  const { organizationId, page, pageSize, action } = filters;
  const where = { organizationId, ...(action && { action }) };

  const [items, total] = await Promise.all([
    prisma.aiAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.aiAuditLog.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface AiAuditStats {
  totalRequests: number;
  requestsByAction: Array<{ action: string; count: number }>;
  last24h: number;
}

export async function getAiAuditStats(organizationId: string): Promise<AiAuditStats> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalRequests, requestsByAction, last24h] = await Promise.all([
    prisma.aiAuditLog.count({ where: { organizationId } }),
    prisma.aiAuditLog.groupBy({ by: ['action'], where: { organizationId }, _count: { _all: true } }),
    prisma.aiAuditLog.count({ where: { organizationId, createdAt: { gte: since24h } } }),
  ]);

  return {
    totalRequests,
    requestsByAction: requestsByAction.map((group) => ({ action: group.action, count: group._count._all })),
    last24h,
  };
}
