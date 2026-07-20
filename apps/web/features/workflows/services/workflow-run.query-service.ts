import { requireRole } from '@bond-os/auth';
import {
  createEvent,
  getWorkflowDefinitionById,
  getWorkflowRunById,
  listWorkflowRunSteps,
  listWorkflowRuns,
  updateWorkflowRunStatus,
  type ListWorkflowRunsFilters,
  type WorkflowRunData,
  type WorkflowRunStepData,
} from '@bond-os/database';
import { NotFoundError, ROLES, ValidationError, type PaginatedResult } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

import { createWorkflowDispatchBudget, enterWorkflowDispatch } from '../lib/workflow-dispatch-budget';
import { startWorkflowRun } from './workflow-run.service';

/**
 * User-facing read/trigger surface over `WorkflowRun` (Phase 8) — separate
 * from `workflow-run.service.ts`'s internal driver functions
 * (`startWorkflowRun`/`resumeWorkflowRunById`), which are called by
 * `event-bus.service.ts`/the tick endpoint/the approval-resume hook, none
 * of which have a live user session to `requireRole` against. This class
 * is the one with that check. See docs/workflows.md.
 */
export class WorkflowRunService {
  async list(filters: ListWorkflowRunsFilters): Promise<PaginatedResult<WorkflowRunData>> {
    await requireRole(filters.organizationId, ROLES.MEMBER);
    return listWorkflowRuns(filters);
  }

  async get(id: string, organizationId: string): Promise<{ run: WorkflowRunData; steps: WorkflowRunStepData[] }> {
    await requireRole(organizationId, ROLES.MEMBER);
    const run = await getWorkflowRunById(id, organizationId);
    if (!run) throw new NotFoundError('Workflow run not found.');
    const steps = await listWorkflowRunSteps(id);
    return { run, steps };
  }

  async cancel(id: string, organizationId: string): Promise<void> {
    await requireRole(organizationId, ROLES.MEMBER);
    const run = await getWorkflowRunById(id, organizationId);
    if (!run) throw new NotFoundError('Workflow run not found.');
    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED' || run.status === 'ROLLED_BACK') {
      throw new ValidationError(`Cannot cancel a run that is already ${run.status}.`);
    }
    await updateWorkflowRunStatus(id, organizationId, { status: 'CANCELLED', completedAt: new Date() });
  }

  /** The MANUAL trigger type / "Run Now" button — starts a run directly against a specific `WorkflowDefinition`, bypassing event-matching entirely since the caller already picked the target. */
  async triggerManual(
    organizationId: string,
    userId: string,
    workflowDefinitionId: string,
    payload: Record<string, unknown> = {},
  ): Promise<WorkflowRunData> {
    await requireRole(organizationId, ROLES.MEMBER);

    const definition = await getWorkflowDefinitionById(workflowDefinitionId, organizationId);
    if (!definition) throw new NotFoundError('Workflow not found.');
    if (definition.status !== 'ACTIVE') throw new ValidationError('Only an ACTIVE workflow can be run.');

    const event = await createEvent({
      organizationId,
      eventType: 'workflow.manual_trigger',
      source: 'SYSTEM',
      payload: { triggeredById: userId, ...payload },
      correlationId: crypto.randomUUID(),
      metadata: { manual: true },
    });

    const env = getEnv();
    const budget = createWorkflowDispatchBudget(env.WORKFLOW_MAX_SYNC_STEPS, env.WORKFLOW_MAX_SYNC_MS);
    enterWorkflowDispatch(budget, definition.id);
    return startWorkflowRun(definition, event, budget);
  }
}
