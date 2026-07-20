import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { WorkflowRunStatus } from '../generated/index.js';

/** One row per trigger firing (Phase 8) — pins `workflowDefinitionId` to the exact version active when triggered. See docs/workflows.md. */

export interface WorkflowRunData {
  id: string;
  organizationId: string;
  workflowDefinitionId: string;
  triggerEventId: string | null;
  status: WorkflowRunStatus;
  correlationId: string;
  causationId: string | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkflowRunData {
  organizationId: string;
  workflowDefinitionId: string;
  triggerEventId?: string | null;
  status?: WorkflowRunStatus;
  correlationId: string;
  causationId?: string | null;
}

export async function createWorkflowRun(data: CreateWorkflowRunData): Promise<WorkflowRunData> {
  return prisma.workflowRun.create({ data });
}

export async function getWorkflowRunById(id: string, organizationId: string): Promise<WorkflowRunData | null> {
  return prisma.workflowRun.findFirst({ where: { id, organizationId } });
}

export interface ListWorkflowRunsFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: WorkflowRunStatus;
  workflowDefinitionId?: string;
}

export async function listWorkflowRuns(filters: ListWorkflowRunsFilters): Promise<PaginatedResult<WorkflowRunData>> {
  const { organizationId, page, pageSize, status, workflowDefinitionId } = filters;
  const where = { organizationId, ...(status && { status }), ...(workflowDefinitionId && { workflowDefinitionId }) };

  const [items, total] = await Promise.all([
    prisma.workflowRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.workflowRun.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface UpdateWorkflowRunStatusData {
  status: WorkflowRunStatus;
  error?: string | null;
  completedAt?: Date | null;
}

export async function updateWorkflowRunStatus(id: string, organizationId: string, data: UpdateWorkflowRunStatusData): Promise<void> {
  await prisma.workflowRun.updateMany({ where: { id, organizationId }, data: { ...data, updatedAt: new Date() } });
}

/** Count of a `WorkflowDefinition`'s runs currently anywhere in an unresolved chain (used by the dispatch budget's cycle guard against re-entrant firing). */
export async function countActiveRunsForDefinition(workflowDefinitionId: string, organizationId: string): Promise<number> {
  return prisma.workflowRun.count({
    where: {
      workflowDefinitionId,
      organizationId,
      status: { in: ['PENDING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_TIMER'] },
    },
  });
}
