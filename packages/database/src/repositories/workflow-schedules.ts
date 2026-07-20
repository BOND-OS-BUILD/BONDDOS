import { prisma } from '../client';
import type { WorkflowScheduleStatus } from '../generated/index.js';

/**
 * Drives the tick endpoint (Phase 8, `POST /api/workflows/schedule/tick`) —
 * one row per SCHEDULED-trigger `WorkflowDefinition`. `listDueWorkflowSchedules`
 * and `claimWorkflowSchedule` are deliberately CROSS-ORGANIZATION — the tick
 * handler has no session to scope by, the one documented exception to this
 * codebase's "every function takes organizationId first" convention. Kept
 * structurally separate from the org-scoped functions below; never imported
 * by a per-org service. See docs/scheduling.md.
 */

export interface WorkflowScheduleData {
  id: string;
  organizationId: string;
  workflowDefinitionId: string;
  cronExpression: string;
  timezone: string;
  nextRunAt: Date;
  lastRunAt: Date | null;
  status: WorkflowScheduleStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkflowScheduleData {
  organizationId: string;
  workflowDefinitionId: string;
  cronExpression: string;
  timezone: string;
  nextRunAt: Date;
}

export async function createWorkflowSchedule(data: CreateWorkflowScheduleData): Promise<WorkflowScheduleData> {
  return prisma.workflowSchedule.create({ data });
}

export async function getWorkflowScheduleByDefinitionId(
  workflowDefinitionId: string,
  organizationId: string,
): Promise<WorkflowScheduleData | null> {
  return prisma.workflowSchedule.findFirst({ where: { workflowDefinitionId, organizationId } });
}

export async function pauseWorkflowSchedule(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.workflowSchedule.updateMany({ where: { id, organizationId }, data: { status: 'PAUSED' } });
  return result.count > 0;
}

export async function resumeWorkflowSchedule(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.workflowSchedule.updateMany({ where: { id, organizationId }, data: { status: 'ACTIVE' } });
  return result.count > 0;
}

/** Cross-organization — every `ACTIVE` schedule due to fire, for the tick handler to iterate. */
export async function listDueWorkflowSchedules(now: Date): Promise<WorkflowScheduleData[]> {
  return prisma.workflowSchedule.findMany({ where: { status: 'ACTIVE', nextRunAt: { lte: now } } });
}

/**
 * Atomic claim — mirrors `ApprovalRequest`'s single-use-enforcement idiom
 * via a conditional `updateMany`: only succeeds (returns `true`) if
 * `nextRunAt` still matches what the caller last read, preventing two
 * overlapping tick invocations from both dispatching the same firing.
 */
export async function claimWorkflowSchedule(id: string, expectedNextRunAt: Date, newNextRunAt: Date, firedAt: Date): Promise<boolean> {
  const result = await prisma.workflowSchedule.updateMany({
    where: { id, nextRunAt: expectedNextRunAt },
    data: { nextRunAt: newNextRunAt, lastRunAt: firedAt },
  });
  return result.count === 1;
}
