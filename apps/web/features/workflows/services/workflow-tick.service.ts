import {
  claimWorkflowSchedule,
  createEvent,
  getEventById,
  getWorkflowDefinitionById,
  getWorkflowRunById,
  listDueWaitingSteps,
  listDueWorkflowSchedules,
} from '@bond-os/database';
import { getEnv, logger } from '@bond-os/shared/server';

import { computeNextRunAt } from '../lib/cron';
import { createWorkflowDispatchBudget, enterWorkflowDispatch } from '../lib/workflow-dispatch-budget';
import { resumeWorkflowRunById, startWorkflowRun } from './workflow-run.service';

const log = logger.child('workflow-tick');

export interface WorkflowTickResult {
  schedulesDispatched: number;
  timersResumed: number;
  errors: number;
}

/**
 * The one entry point for all time-based workflow execution (Phase 8) — no
 * background worker exists anywhere in this codebase, so this only ever
 * runs when something external calls it (see docs/scheduling.md). Genuinely
 * cross-organization (there is no session to scope by), which is why it
 * calls the deliberately-unscoped repository functions
 * (`listDueWorkflowSchedules`/`listDueWaitingSteps`) directly rather than
 * going through any per-org service. One workflow's failure never aborts
 * the sweep for every other organization's due work.
 */
export async function runWorkflowTick(): Promise<WorkflowTickResult> {
  const now = new Date();
  const env = getEnv();
  let schedulesDispatched = 0;
  let timersResumed = 0;
  let errors = 0;

  const dueSchedules = await listDueWorkflowSchedules(now);
  for (const schedule of dueSchedules) {
    try {
      const nextRunAt = computeNextRunAt(schedule.cronExpression, schedule.timezone, now);
      const claimed = await claimWorkflowSchedule(schedule.id, schedule.nextRunAt, nextRunAt, now);
      if (!claimed) continue; // another concurrent tick invocation already claimed this firing

      const definition = await getWorkflowDefinitionById(schedule.workflowDefinitionId, schedule.organizationId);
      if (!definition || definition.status !== 'ACTIVE') continue;

      const event = await createEvent({
        organizationId: schedule.organizationId,
        eventType: 'workflow.scheduled_trigger',
        source: 'SYSTEM',
        payload: { scheduleId: schedule.id, workflowDefinitionId: definition.id },
        correlationId: crypto.randomUUID(),
        metadata: { tick: true },
      });

      const budget = createWorkflowDispatchBudget(env.WORKFLOW_MAX_SYNC_STEPS, env.WORKFLOW_MAX_SYNC_MS);
      enterWorkflowDispatch(budget, definition.id);
      await startWorkflowRun(definition, event, budget);
      schedulesDispatched += 1;
    } catch (error) {
      errors += 1;
      log.error('Scheduled workflow dispatch failed', {
        scheduleId: schedule.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const dueSteps = await listDueWaitingSteps(now);
  const runsToResume = new Map<string, string>();
  for (const step of dueSteps) runsToResume.set(step.runId, step.run.organizationId);

  for (const [runId, organizationId] of runsToResume) {
    try {
      const run = await getWorkflowRunById(runId, organizationId);
      if (!run) continue;
      const definition = await getWorkflowDefinitionById(run.workflowDefinitionId, organizationId);
      if (!definition) continue;
      const event = run.triggerEventId ? await getEventById(run.triggerEventId, organizationId) : null;
      if (!event) continue;

      const budget = createWorkflowDispatchBudget(env.WORKFLOW_MAX_SYNC_STEPS, env.WORKFLOW_MAX_SYNC_MS);
      await resumeWorkflowRunById(runId, organizationId, definition, event, budget);
      timersResumed += 1;
    } catch (error) {
      errors += 1;
      log.error('Timer resume failed', { runId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  log.info('Workflow tick complete', { schedulesDispatched, timersResumed, errors });
  return { schedulesDispatched, timersResumed, errors };
}
