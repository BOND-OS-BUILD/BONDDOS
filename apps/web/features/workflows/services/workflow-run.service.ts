import {
  claimWorkflowRunStep,
  countActiveRunsForDefinition,
  createWorkflowRun,
  createWorkflowRunStep,
  getApprovalRequestByPlanId,
  getEventById,
  getToolExecutionByPlanId,
  getWorkflowDefinitionById,
  getWorkflowRunById,
  getWorkflowRunStepByPlanId,
  listWorkflowRunSteps,
  updateWorkflowRunStatus,
  updateWorkflowRunStep,
  type EventData,
  type Prisma,
  type WorkflowDefinitionData,
  type WorkflowRunData,
  type WorkflowRunStepData,
} from '@bond-os/database';
import { getEnv, logger } from '@bond-os/shared/server';

import { computeLayers, isTerminalStepStatus, resolveStepParams, validatePlanSteps, type StepRuntimeInfo } from '@/features/planner/lib/dag';
import { evaluateCondition } from '@/features/planner/lib/condition-registry';
import { getRollbackService, getToolRegistryService } from '@/features/execution/lib/container';
import type { ToolContext } from '@/features/tools/lib/tool-definition';

import { consumeWorkflowStep, createWorkflowDispatchBudget, type WorkflowDispatchBudget } from '../lib/workflow-dispatch-budget';
import type { WorkflowGraphDefinition } from '../lib/workflow-graph';
import type { WorkflowStepHandlerContext, WorkflowStepOutcome } from '../lib/step-handler';
import { getWorkflowStepHandlerRegistry } from '../registry';

const log = logger.child('workflow-run');

/**
 * A design-review-caught gap: the dispatch budget's cycle guard
 * (`visitedWorkflowDefinitionIds`) only protects ONE synchronous dispatch
 * chain — it cannot see across an `APPROVAL` gap, since resuming after a
 * human clicks approve necessarily starts a fresh budget (the original,
 * in-memory one is long gone by then; approvals can be hours or days
 * later). A workflow whose own approved write re-publishes an event
 * matching its own trigger can therefore spawn a new generation on every
 * approval, forever, un-caught by the in-memory guard alone. A fully
 * correct fix would thread `correlationId` through the entire P6
 * plan/approval/execution chain so cross-gap cycles are DB-detectable —
 * out of scope here (it would mean `ToolContext`/every `*.tool.ts` gaining
 * Phase 8 awareness, which this phase deliberately avoids). This is the
 * honest, bounded mitigation instead: cap concurrent non-terminal runs per
 * `WorkflowDefinition`, so runaway proliferation is capped, not eliminated
 * at the semantic level. See docs/workflows.md.
 */
const MAX_ACTIVE_RUNS_PER_DEFINITION = 5;

export class WorkflowRunLimitExceededError extends Error {
  constructor(workflowDefinitionId: string) {
    super(
      `Workflow "${workflowDefinitionId}" already has ${MAX_ACTIVE_RUNS_PER_DEFINITION} runs in progress — refusing to start another until one finishes. If this workflow's own actions re-trigger itself, check its trigger/conditions for an unintended loop.`,
    );
    this.name = 'WorkflowRunLimitExceededError';
  }
}

/**
 * The re-entrant Workflow Run driver (Phase 8) — NOT a reuse of
 * `execution.service.ts`'s driver: that one assumes an entire DAG layer
 * resolves in one synchronous pass, which cannot survive a Wait/Delay step
 * with a downstream dependent in a later layer. This driver is repeatedly
 * invocable (from `publishEvent()`, the tick endpoint, or a manual resume
 * call) and picks up exactly where persisted `WorkflowRunStep` rows left
 * off — the same "explicitly invoked, one step at a time, state persists"
 * shape `GoalService.advance()` already established. See docs/workflows.md.
 */

export async function startWorkflowRun(
  definition: WorkflowDefinitionData,
  event: EventData,
  budget: WorkflowDispatchBudget,
): Promise<WorkflowRunData> {
  const activeCount = await countActiveRunsForDefinition(definition.id, definition.organizationId);
  if (activeCount >= MAX_ACTIVE_RUNS_PER_DEFINITION) {
    throw new WorkflowRunLimitExceededError(definition.id);
  }

  const run = await createWorkflowRun({
    organizationId: definition.organizationId,
    workflowDefinitionId: definition.id,
    triggerEventId: event.id,
    status: 'RUNNING',
    correlationId: event.correlationId,
    causationId: event.causationId,
  });

  await driveWorkflowRun(definition, run, event, budget);
  return run;
}

/** Called by the tick endpoint (WAITING_TIMER) and the approval-resume route hook (WAITING_APPROVAL) — re-drives an existing run from wherever it left off. Fresh budget each resume; a resumed run's remaining work is bounded independently of whatever consumed the original triggering event's budget. */
export async function resumeWorkflowRunById(
  runId: string,
  organizationId: string,
  definition: WorkflowDefinitionData,
  event: EventData,
  budget: WorkflowDispatchBudget,
): Promise<void> {
  const run = await getWorkflowRunById(runId, organizationId);
  if (!run) throw new Error(`WorkflowRun "${runId}" not found.`);
  if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED' || run.status === 'ROLLED_BACK') return;

  await driveWorkflowRun(definition, run, event, budget);
}

/**
 * The route-layer approval-resume hook's one entry point (Phase 8 §2 —
 * `POST /api/execution/[id]/approve` calls this after its own SSE stream
 * completes, best-effort). Resolves the `WorkflowRunStep` a just-approved
 * `planId` belongs to (if any — most approvals are NOT workflow-originated)
 * and re-drives that run. A no-op, not an error, when `planId` doesn't
 * belong to any workflow.
 */
export async function resumeWorkflowRunByPlanId(planId: string, organizationId: string): Promise<void> {
  const step = await getWorkflowRunStepByPlanId(planId);
  if (!step || step.run.organizationId !== organizationId) return;

  const run = await getWorkflowRunById(step.runId, organizationId);
  if (!run) return;
  const definition = await getWorkflowDefinitionById(run.workflowDefinitionId, organizationId);
  if (!definition) return;
  const event = run.triggerEventId ? await getEventById(run.triggerEventId, organizationId) : null;
  if (!event) return;

  const env = getEnv();
  const budget = createWorkflowDispatchBudget(env.WORKFLOW_MAX_SYNC_STEPS, env.WORKFLOW_MAX_SYNC_MS);
  await resumeWorkflowRunById(run.id, organizationId, definition, event, budget);
}

function toStepRuntimeInfo(steps: WorkflowRunStepData[]): Record<string, StepRuntimeInfo> {
  const record: Record<string, StepRuntimeInfo> = {};
  for (const step of steps) {
    record[step.key] = { status: step.status, output: step.output ?? undefined };
  }
  return record;
}

async function driveWorkflowRun(
  definition: WorkflowDefinitionData,
  run: WorkflowRunData,
  event: EventData,
  budget: WorkflowDispatchBudget,
): Promise<void> {
  const graph = definition.graph as unknown as WorkflowGraphDefinition;
  validatePlanSteps(graph.steps);
  const planGraph = computeLayers(graph.steps);
  const stepDefByKey = new Map(graph.steps.map((step) => [step.key, step]));

  const existingSteps = await listWorkflowRunSteps(run.id);
  const stepRowByKey = new Map(existingSteps.map((step) => [step.key, step]));

  const handlerCtx: WorkflowStepHandlerContext = {
    organizationId: definition.organizationId,
    ownerId: definition.ownerId,
    runId: run.id,
    workflowDefinitionId: definition.id,
    triggerEvent: event,
  };

  for (const layer of planGraph.layers) {
    for (const key of layer) {
      if (!stepRowByKey.has(key)) {
        const stepDef = stepDefByKey.get(key)!;
        const created = await createWorkflowRunStep({
          runId: run.id,
          key,
          stepType: stepDef.stepType,
          input: stepDef.params as unknown as Prisma.InputJsonValue,
          status: 'PENDING',
        });
        stepRowByKey.set(key, created);
      }
    }

    for (const key of layer) {
      const stepDef = stepDefByKey.get(key)!;
      let stepRow = stepRowByKey.get(key)!;

      if (isTerminalStepStatus(stepRow.status)) continue;

      if (stepRow.status === 'WAITING_APPROVAL') {
        const resolution = await tryResolveWaitingApproval(stepRow, definition.organizationId);
        if (resolution.kind === 'still_waiting') {
          await updateWorkflowRunStatus(run.id, definition.organizationId, { status: 'WAITING_APPROVAL' });
          return;
        }

        // Atomic claim (mirrors claimWorkflowSchedule's conditional
        // updateMany idiom) — closes a design-review-caught race: two
        // concurrent drives of this run (e.g. a double-clicked Approve, or
        // its SSE request retrying) can both read WAITING_APPROVAL and both
        // resolve it before either persists. Only the winner proceeds past
        // this step; the loser stops this entire drive invocation, since it
        // cannot safely know how far the winner got downstream.
        const claimedStatus = resolution.kind === 'succeeded' ? 'SUCCEEDED' : 'FAILED';
        const claimed = await claimWorkflowRunStep(stepRow.id, 'WAITING_APPROVAL', claimedStatus);
        if (!claimed) return;

        if (resolution.kind === 'failed') {
          await updateWorkflowRunStep(stepRow.id, { error: resolution.error, completedAt: new Date() });
          await failRun(definition, run, stepRow.key, resolution.error, existingSteps);
          return;
        }

        await updateWorkflowRunStep(stepRow.id, {
          output: resolution.output as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        });
        stepRow = { ...stepRow, status: 'SUCCEEDED', output: resolution.output };
        stepRowByKey.set(key, stepRow);
        continue;
      }

      if (stepRow.status === 'WAITING_TIMER') {
        if (!stepRow.waitUntil || stepRow.waitUntil.getTime() > Date.now()) {
          await updateWorkflowRunStatus(run.id, definition.organizationId, { status: 'WAITING_TIMER' });
          return;
        }

        // Same atomic-claim race protection as WAITING_APPROVAL above, for
        // two overlapping tick invocations resuming the same timer.
        const claimed = await claimWorkflowRunStep(stepRow.id, 'WAITING_TIMER', 'SUCCEEDED');
        if (!claimed) return;

        await updateWorkflowRunStep(stepRow.id, { output: { resumedAt: new Date().toISOString() }, completedAt: new Date() });
        stepRow = { ...stepRow, status: 'SUCCEEDED' };
        stepRowByKey.set(key, stepRow);
        continue;
      }

      // PENDING — evaluate this step's own condition (Phase 6-style named predicate, distinct from the workflow-level trigger `WorkflowConditionNode` tree) before running it.
      if (stepDef.condition) {
        const shouldRun = await evaluateCondition(definition.organizationId, stepDef.condition);
        if (!shouldRun) {
          await updateWorkflowRunStep(stepRow.id, { status: 'SKIPPED', completedAt: new Date() });
          stepRow = { ...stepRow, status: 'SKIPPED' };
          stepRowByKey.set(key, stepRow);
          continue;
        }
      }

      try {
        consumeWorkflowStep(budget);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failStep(stepRow, message);
        await failRun(definition, run, stepRow.key, message, existingSteps);
        return;
      }

      const resolvedParams = resolveStepParams(stepDef.params, toStepRuntimeInfo(Array.from(stepRowByKey.values())));
      const handler = getWorkflowStepHandlerRegistry().get(stepDef.stepType);
      if (!handler) {
        const message = `No handler registered for step type "${stepDef.stepType}".`;
        await failStep(stepRow, message);
        await failRun(definition, run, stepRow.key, message, existingSteps);
        return;
      }

      // Atomic claim, same idiom as the two resume branches above — closes
      // the same class of race for a step's FIRST execution (two concurrent
      // drives of a freshly-created run reaching the same PENDING step).
      const claimedPending = await claimWorkflowRunStep(stepRow.id, 'PENDING', 'RUNNING');
      if (!claimedPending) return;
      await updateWorkflowRunStep(stepRow.id, { startedAt: new Date() });

      let outcome: WorkflowStepOutcome;
      try {
        outcome = await handler.execute(handlerCtx, resolvedParams, budget);
      } catch (error) {
        outcome = { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
      }

      switch (outcome.kind) {
        case 'succeeded':
          await updateWorkflowRunStep(stepRow.id, {
            status: 'SUCCEEDED',
            output: outcome.output as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
          });
          stepRow = { ...stepRow, status: 'SUCCEEDED', output: outcome.output };
          break;
        case 'skipped':
          await updateWorkflowRunStep(stepRow.id, { status: 'SKIPPED', completedAt: new Date() });
          stepRow = { ...stepRow, status: 'SKIPPED' };
          break;
        case 'waiting_approval':
          await updateWorkflowRunStep(stepRow.id, { status: 'WAITING_APPROVAL', planId: outcome.planId });
          await updateWorkflowRunStatus(run.id, definition.organizationId, { status: 'WAITING_APPROVAL' });
          return;
        case 'waiting_timer':
          await updateWorkflowRunStep(stepRow.id, { status: 'WAITING_TIMER', waitUntil: outcome.waitUntil });
          await updateWorkflowRunStatus(run.id, definition.organizationId, { status: 'WAITING_TIMER' });
          return;
        case 'failed':
          await updateWorkflowRunStep(stepRow.id, { status: 'FAILED', error: outcome.error, completedAt: new Date() });
          if (!outcome.continueOnFailure) {
            await failRun(definition, run, stepRow.key, outcome.error, existingSteps);
            return;
          }
          stepRow = { ...stepRow, status: 'FAILED' };
          break;
        default: {
          const exhaustive: never = outcome;
          throw new Error(`Unknown workflow step outcome: ${JSON.stringify(exhaustive)}`);
        }
      }

      stepRowByKey.set(key, stepRow);
    }
  }

  await updateWorkflowRunStatus(run.id, definition.organizationId, { status: 'COMPLETED', completedAt: new Date() });

  const { publishEvent } = await import('./event-bus.service');
  await publishEvent({
    organizationId: definition.organizationId,
    eventType: 'workflow.notification',
    source: 'SYSTEM',
    payload: { runId: run.id, workflowDefinitionId: definition.id, status: 'completed' },
    entityType: 'WORKFLOW_RUN',
    entityId: run.id,
  });
}

async function failStep(step: WorkflowRunStepData, error: string): Promise<void> {
  await updateWorkflowRunStep(step.id, { status: 'FAILED', error, completedAt: new Date() });
}

type ApprovalResolution =
  | { kind: 'still_waiting' }
  | { kind: 'succeeded'; output: Record<string, unknown> }
  | { kind: 'failed'; error: string };

async function tryResolveWaitingApproval(step: WorkflowRunStepData, organizationId: string): Promise<ApprovalResolution> {
  if (!step.planId) return { kind: 'failed', error: 'A WAITING_APPROVAL step has no planId to resolve against.' };

  const execution = await getToolExecutionByPlanId(step.planId, organizationId);
  if (execution) {
    if (execution.status === 'SUCCEEDED') return { kind: 'succeeded', output: { toolExecutionId: execution.id } };
    if (execution.status === 'FAILED' || execution.status === 'ROLLED_BACK') {
      return { kind: 'failed', error: execution.error ?? 'The proposed action failed.' };
    }
    return { kind: 'still_waiting' };
  }

  const approval = await getApprovalRequestByPlanId(step.planId, organizationId);
  if (approval && (approval.status === 'REJECTED' || approval.status === 'EXPIRED')) {
    return { kind: 'failed', error: `The proposed action was ${approval.status.toLowerCase()}.` };
  }

  return { kind: 'still_waiting' };
}

/**
 * Rolls back every prior SUCCEEDED INVOKE_TOOL step of this run, in reverse
 * order, via the existing, unmodified `RollbackService` — direct reuse of
 * Phase 6's rollback mechanism per step's own `ExecutionPlan`, not a new
 * one. A step whose tool doesn't support rollback is recorded as requiring
 * manual intervention rather than silently reported as reversed, mirroring
 * the Phase 6 fix where a zero-row rollback match throws instead of
 * reporting false success.
 */
async function failRun(
  definition: WorkflowDefinitionData,
  run: WorkflowRunData,
  failedStepKey: string,
  error: string,
  priorSteps: WorkflowRunStepData[],
): Promise<void> {
  await updateWorkflowRunStatus(run.id, definition.organizationId, { status: 'FAILED', error, completedAt: new Date() });

  const rollbackPolicy = definition.rollbackPolicy as { enabled?: boolean } | null;
  const shouldRollback = rollbackPolicy?.enabled !== false;
  const invokeToolSteps = priorSteps.filter((step) => step.stepType === 'INVOKE_TOOL' && step.status === 'SUCCEEDED' && step.planId);

  if (shouldRollback && invokeToolSteps.length > 0 && definition.ownerId) {
    await rollbackWorkflowSteps(definition.organizationId, definition.ownerId, invokeToolSteps);
  }

  const { publishEvent } = await import('./event-bus.service');
  await publishEvent({
    organizationId: definition.organizationId,
    eventType: 'workflow.notification',
    source: 'SYSTEM',
    payload: { runId: run.id, workflowDefinitionId: definition.id, status: 'failed', failedStepKey, error },
    entityType: 'WORKFLOW_RUN',
    entityId: run.id,
  });
}

async function rollbackWorkflowSteps(organizationId: string, ownerId: string, steps: WorkflowRunStepData[]): Promise<void> {
  const ctx: ToolContext = { organizationId, userId: ownerId };
  const toolRegistry = getToolRegistryService();
  const rollbackService = getRollbackService();

  for (const step of [...steps].reverse()) {
    if (!step.planId) continue;
    try {
      const execution = await getToolExecutionByPlanId(step.planId, organizationId);
      if (!execution) continue;

      const output = (step.output as { toolExecutionId?: string } | null) ?? {};
      const toolKeyAndResult = extractRollbackTarget(step.input as Record<string, unknown>, output);
      if (!toolKeyAndResult) continue;

      const tool = toolRegistry.getLatest(toolKeyAndResult.toolKey);
      if (!tool) continue;

      await rollbackService.rollbackSteps(ctx, execution.id, [{ stepKey: step.key, tool, result: toolKeyAndResult.result }]);
    } catch (rollbackError) {
      log.error('Workflow step rollback failed', {
        stepId: step.id,
        message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
  }
}

function extractRollbackTarget(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): { toolKey: string; result: unknown } | null {
  const toolKey = input.__toolKey;
  if (typeof toolKey !== 'string') return null;
  return { toolKey, result: output };
}
