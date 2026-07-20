import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Prisma } from '../generated/index.js';

/**
 * Immutable, append-only compliance trail for the Tool Execution Framework's
 * write lifecycle (Phase 6) — mirrors `TimelineEvent`'s "never edited or
 * deleted" convention. Distinct from Phase 4's `AiAuditLog` (documented
 * fire-and-forget observability for read/generation calls). See
 * docs/tool-execution.md.
 */

export interface AppendAuditEventData {
  organizationId: string;
  executionId?: string | null;
  userId?: string | null;
  action: string;
  metadata?: Prisma.InputJsonValue;
}

export async function appendAuditEvent(data: AppendAuditEventData): Promise<void> {
  await prisma.auditEvent.create({ data });
}

export interface AuditEventItem {
  id: string;
  executionId: string | null;
  userId: string | null;
  action: string;
  metadata: unknown;
  createdAt: Date;
}

export interface ListAuditEventsFilters {
  organizationId: string;
  executionId?: string;
  page: number;
  pageSize: number;
}

export async function listAuditEvents(filters: ListAuditEventsFilters): Promise<PaginatedResult<AuditEventItem>> {
  const { organizationId, executionId, page, pageSize } = filters;
  const where = { organizationId, ...(executionId && { executionId }) };

  const [items, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditEvent.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
