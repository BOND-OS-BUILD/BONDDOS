import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { InsightStatus, InsightType, Prisma } from '../generated/index.js';

/** Agent observations, never data mutations (Phase 7) — `status` (acknowledge/dismiss) is bookkeeping on the insight itself, not a domain write, so it doesn't go through the Phase 6 approval chain. See docs/insights.md. */

export interface InsightData {
  id: string;
  organizationId: string;
  agentId: string;
  goalId: string | null;
  type: InsightType;
  title: string;
  description: string;
  relatedEntityIds: unknown;
  status: InsightStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInsightData {
  organizationId: string;
  agentId: string;
  goalId?: string | null;
  type: InsightType;
  title: string;
  description: string;
  relatedEntityIds: Prisma.InputJsonValue;
}

export async function createInsight(data: CreateInsightData): Promise<InsightData> {
  return prisma.insight.create({ data });
}

export interface ListInsightsFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: InsightStatus;
  agentId?: string;
}

export async function listInsights(filters: ListInsightsFilters): Promise<PaginatedResult<InsightData>> {
  const { organizationId, page, pageSize, status, agentId } = filters;
  const where = { organizationId, ...(status && { status }), ...(agentId && { agentId }) };

  const [items, total] = await Promise.all([
    prisma.insight.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.insight.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function updateInsightStatus(id: string, organizationId: string, status: InsightStatus): Promise<boolean> {
  const result = await prisma.insight.updateMany({ where: { id, organizationId }, data: { status } });
  return result.count > 0;
}
