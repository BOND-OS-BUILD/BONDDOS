import { prisma } from '../client';
import { Prisma, type WorkflowStepRunStatus, type WorkflowStepType } from '../generated/index.js';

/**
 * One row per step execution within a `WorkflowRun` (Phase 8) — mirrors
 * `ExecutionStep`/`GoalStep`'s "own indexed table for the mutable,
 * accumulating-over-time part" precedent. Has no `organizationId` column of
 * its own (same shape as `ExecutionStep`) — scoped via its parent `run`
 * relation; callers that need org-scoping fetch through
 * `getWorkflowRunStepWithOrg` and verify `organizationId` themselves.
 * `listDueWaitingSteps` is the one deliberately CROSS-ORGANIZATION function
 * here — the tick endpoint has no session, see docs/scheduling.md.
 */

export interface WorkflowRunStepData {
  id: string;
  runId: string;
  key: string;
  stepType: WorkflowStepType;
  status: WorkflowStepRunStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  attempt: number;
  loopIndex: number | null;
  waitUntil: Date | null;
  planId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface CreateWorkflowRunStepData {
  runId: string;
  key: string;
  stepType: WorkflowStepType;
  status?: WorkflowStepRunStatus;
  input: Prisma.InputJsonValue;
  loopIndex?: number | null;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Race-safe against two concurrent drives of the same run reaching the
 * same layer at once (a design-review-caught gap: `@@unique([runId, key])`
 * is the real enforcement — this function just makes that constraint
 * ergonomic to call). If another invocation already created this step's
 * row first, returns THEIR row instead of throwing or creating a duplicate.
 */
export async function createWorkflowRunStep(data: CreateWorkflowRunStepData): Promise<WorkflowRunStepData> {
  try {
    return await prisma.workflowRunStep.create({ data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      const existing = await getWorkflowRunStepByKey(data.runId, data.key);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function listWorkflowRunSteps(runId: string): Promise<WorkflowRunStepData[]> {
  return prisma.workflowRunStep.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
}

export async function getWorkflowRunStepById(id: string): Promise<WorkflowRunStepData | null> {
  return prisma.workflowRunStep.findUnique({ where: { id } });
}

export async function getWorkflowRunStepByKey(runId: string, key: string): Promise<WorkflowRunStepData | null> {
  return prisma.workflowRunStep.findUnique({ where: { runId_key: { runId, key } } });
}

/**
 * Atomic conditional transition — mirrors `claimWorkflowSchedule`'s exact
 * idiom (`updateMany` matching the caller's last-read status, `count===1`
 * is the only signal of success). This is what actually closes the
 * double-resume race a design review caught: two concurrent drives (two
 * overlapping tick invocations, or a tick overlapping a manual resume)
 * reading the same `WAITING_TIMER`/`WAITING_APPROVAL` row both attempt this
 * claim, but only one can win — the other must back off rather than also
 * executing this step's downstream effects.
 */
export async function claimWorkflowRunStep(id: string, expectedStatus: WorkflowStepRunStatus, claimedStatus: WorkflowStepRunStatus = 'RUNNING'): Promise<boolean> {
  const result = await prisma.workflowRunStep.updateMany({ where: { id, status: expectedStatus }, data: { status: claimedStatus } });
  return result.count === 1;
}

/** The primary resume-lookup key for an approved/executed plan: `planId` is shared across `ExecutionPlan`/`ApprovalRequest`/`ToolExecution` and (for an INVOKE_TOOL step) this row — resolvable before `ToolExecution` even exists (during WAITING_APPROVAL). */
export async function getWorkflowRunStepByPlanId(planId: string): Promise<WorkflowRunStepWithOrg | null> {
  return prisma.workflowRunStep.findFirst({ where: { planId }, include: { run: { select: { organizationId: true } } } });
}

export interface WorkflowRunStepWithOrg extends WorkflowRunStepData {
  run: { organizationId: string };
}

/** Includes the parent run's `organizationId` — the route-layer approval-resume hook uses this to confirm the `ToolExecution` it's resuming from actually belongs to the caller's organization before acting. */
export async function getWorkflowRunStepWithOrg(id: string): Promise<WorkflowRunStepWithOrg | null> {
  return prisma.workflowRunStep.findUnique({ where: { id }, include: { run: { select: { organizationId: true } } } });
}

export interface UpdateWorkflowRunStepData {
  status?: WorkflowStepRunStatus;
  output?: Prisma.InputJsonValue;
  error?: string | null;
  attempt?: number;
  waitUntil?: Date | null;
  planId?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export async function updateWorkflowRunStep(id: string, data: UpdateWorkflowRunStepData): Promise<void> {
  await prisma.workflowRunStep.update({ where: { id }, data });
}

/**
 * Cross-organization by design — the tick endpoint has no session to scope
 * by. `WHERE status = WAITING_TIMER AND waitUntil <= now`, the resumption
 * half of the same "is it time yet" question `WorkflowSchedule` answers for
 * new triggers. Kept structurally separate from every org-scoped function
 * above, never imported by a per-org service.
 */
export async function listDueWaitingSteps(now: Date): Promise<WorkflowRunStepWithOrg[]> {
  return prisma.workflowRunStep.findMany({
    where: { status: 'WAITING_TIMER', waitUntil: { lte: now } },
    include: { run: { select: { organizationId: true } } },
  });
}
