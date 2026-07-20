import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { ExecutionStatus, RollbackRecordStatus } from '../generated/index.js';

/** One row per plan execution attempt (Phase 6) — mirrors `SyncJob`/`EmbeddingJob`: a single mutable row, org-scoped `updateMany` for every state transition. See docs/tool-execution.md. */

export interface ToolExecutionData {
  id: string;
  planId: string;
  toolId: string | null;
  organizationId: string;
  conversationId: string | null;
  status: ExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  duration: number | null;
  createdById: string | null;
  rollbackStatus: RollbackRecordStatus;
  error: string | null;
  createdAt: Date;
}

export interface CreateToolExecutionData {
  id?: string;
  planId: string;
  /** Only meaningful for single-step plans — see the schema comment on `ToolExecution.toolId`. */
  toolId?: string | null;
  organizationId: string;
  conversationId?: string | null;
  createdById?: string | null;
}

/** Created only after `ApprovalRequest.status` has already atomically transitioned to `APPROVED` (see `transitionApprovalRequest`) — execution is synchronous with no queue, so the row starts life already `EXECUTING`. */
export async function createToolExecution(data: CreateToolExecutionData): Promise<ToolExecutionData> {
  return prisma.toolExecution.create({ data: { ...data, status: 'EXECUTING', startedAt: new Date() } });
}

export async function getToolExecutionById(id: string, organizationId: string): Promise<ToolExecutionData | null> {
  return prisma.toolExecution.findFirst({ where: { id, organizationId } });
}

export async function getToolExecutionByPlanId(planId: string, organizationId: string): Promise<ToolExecutionData | null> {
  return prisma.toolExecution.findFirst({ where: { planId, organizationId } });
}

export interface UpdateToolExecutionStatusData {
  status: ExecutionStatus;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  error?: string | null;
  rollbackStatus?: RollbackRecordStatus;
}

export async function updateToolExecutionStatus(
  id: string,
  organizationId: string,
  data: UpdateToolExecutionStatusData,
): Promise<void> {
  await prisma.toolExecution.updateMany({ where: { id, organizationId }, data });
}

export interface ToolExecutionListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: ExecutionStatus;
}

export async function listToolExecutions(filters: ToolExecutionListFilters): Promise<PaginatedResult<ToolExecutionData>> {
  const { organizationId, page, pageSize, status } = filters;
  const where = { organizationId, ...(status && { status }) };

  const [items, total] = await Promise.all([
    prisma.toolExecution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.toolExecution.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
