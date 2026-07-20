import {
  createExecutionSteps,
  createMessage,
  createToolExecution,
  getExecutionPlanById,
  updateExecutionStep,
  updateToolExecutionStatus,
  type Prisma,
  type Role,
} from '@bond-os/database';
import { ConflictError, NotFoundError } from '@bond-os/shared';

import { evaluateCondition } from '@/features/planner/lib/condition-registry';
import {
  resolveStepParams,
  type ExecutionStepDefinition,
  type PlanGraph,
  type StepRuntimeInfo,
} from '@/features/planner/lib/dag';
import type { PlannerService } from '@/features/planner/services/planner.service';
import type { AnyToolDefinition, ToolContext } from '@/features/tools/lib/tool-definition';
import type { ToolRegistryService } from '@/features/tools/services/tool-registry.service';
import type { ValidationService } from '@/features/tools/services/validation.service';

import type { ApprovalService } from '../../approvals/services/approval.service';
import type { AuditService } from '../../audit/services/audit.service';
import type { CompletedStepForRollback, RollbackService } from '../../rollback/services/rollback.service';
import type { ExecutionStepEventData, ExecutionStreamEvent } from '../lib/execution-stream-events';

/**
 * The Execution Engine (Phase 6, spec: "The engine owns execution. The AI
 * never executes tools directly."). An async generator, the exact same
 * shape as `runBondChatPipeline` — `/api/execution/[id]/approve` primes it
 * once (so pre-stream errors, like a lost approval race, return normal
 * JSON errors) then hands it to the unmodified `createSseStream`. Nothing
 * past `approvalService.approve()`'s first line runs without that call
 * having already succeeded — that's the one and only door into every write
 * below. See docs/tool-execution.md.
 */
export class ExecutionService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly validation: ValidationService,
    private readonly approvalService: ApprovalService,
    private readonly auditService: AuditService,
    private readonly rollbackService: RollbackService,
    private readonly plannerService: PlannerService,
  ) {}

  async *executeApprovedPlan(ctx: ToolContext, planId: string, callerRole: Role): AsyncGenerator<ExecutionStreamEvent> {
    // 1. THE gate. Everything below this line only runs because this succeeded.
    await this.approvalService.approve(ctx.organizationId, ctx.userId, planId, callerRole);
    await this.auditService.record(ctx.organizationId, 'approved', { userId: ctx.userId, metadata: { planId } });

    // 2. Load + re-verify plan integrity (planHash) — a mismatch means the
    // plan changed since it was approved; hard-fail rather than run it.
    const plan = await getExecutionPlanById(planId, ctx.organizationId);
    if (!plan) throw new NotFoundError('Execution plan not found.');

    const stepDefs = plan.steps as unknown as ExecutionStepDefinition[];
    const graph = plan.graph as unknown as PlanGraph;

    if (this.plannerService.hashSteps(stepDefs) !== plan.planHash) {
      throw new ConflictError('This plan changed since it was approved. Please build and approve a new plan.');
    }

    // 3. Resolve every step's tool up front. An unregistered/removed tool
    // version fails validation before anything executes, not mid-plan.
    const toolsByKey = new Map<string, AnyToolDefinition>();
    const stepsByKey = new Map<string, ExecutionStepDefinition>();
    for (const step of stepDefs) {
      const tool = this.registry.get(step.toolKey, step.version);
      if (!tool) throw new NotFoundError(`Tool "${step.toolKey}@${step.version}" is no longer registered.`);
      toolsByKey.set(step.key, tool);
      stepsByKey.set(step.key, step);
    }

    const execution = await createToolExecution({
      planId,
      toolId: null,
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      createdById: ctx.userId,
    });

    const flatOrder = graph.layers.flat();
    await createExecutionSteps(
      flatOrder.map((key, index) => ({ executionId: execution.id, order: index, tool: stepsByKey.get(key)!.toolKey })),
    );
    const orderByKey = new Map(flatOrder.map((key, index) => [key, index]));

    yield { type: 'execution_started', executionId: execution.id, totalSteps: stepDefs.length };

    const runtime: Record<string, StepRuntimeInfo> = {};
    const completedForRollback: CompletedStepForRollback[] = [];
    let failure: { stepKey: string; error: string } | null = null;

    for (const layer of graph.layers) {
      if (failure) break;

      // Steps in a layer run in parallel (Promise.all); "started" is
      // reported for the whole layer up front since there's no per-step
      // sub-event before the parallel batch settles.
      for (const key of layer) {
        const tool = toolsByKey.get(key)!;
        yield { type: 'step_started', step: { stepKey: key, toolKey: tool.toolKey, displayName: tool.displayName } };
      }

      const outcomes = await Promise.all(
        layer.map((key) => this.runStep(ctx, execution.id, key, stepsByKey.get(key)!, toolsByKey.get(key)!, runtime, orderByKey.get(key)!)),
      );

      for (let index = 0; index < layer.length; index += 1) {
        const key = layer[index]!;
        const outcome = outcomes[index]!;

        yield outcome.event;

        runtime[key] = outcome.runtime;
        if (outcome.completedForRollback) completedForRollback.push(outcome.completedForRollback);
        if (outcome.event.type === 'step_failed' && !failure) {
          failure = { stepKey: key, error: outcome.event.error };
        }
      }
    }

    if (failure) {
      yield { type: 'rollback_started' };
      const rollbackOutcome = await this.rollbackService.rollbackSteps(ctx, execution.id, completedForRollback);
      yield rollbackOutcome.succeeded ? { type: 'rollback_succeeded' } : { type: 'rollback_failed', error: 'One or more steps could not be rolled back — see the audit trail.' };

      await updateToolExecutionStatus(execution.id, ctx.organizationId, {
        status: rollbackOutcome.succeeded ? 'ROLLED_BACK' : 'FAILED',
        completedAt: new Date(),
        error: failure.error,
        rollbackStatus: rollbackOutcome.succeeded ? 'SUCCEEDED' : 'FAILED',
      });
      await this.auditService.record(ctx.organizationId, 'execution_failed', {
        executionId: execution.id,
        userId: ctx.userId,
        metadata: { stepKey: failure.stepKey, error: failure.error },
      });

      const message = await this.persistOutcomeMessage(
        ctx,
        execution.id,
        plan.summary,
        false,
        failure.error,
        rollbackOutcome.succeeded,
      );
      yield { type: 'execution_failed', executionId: execution.id, messageId: message?.id ?? null, error: failure.error };
      return;
    }

    await updateToolExecutionStatus(execution.id, ctx.organizationId, { status: 'SUCCEEDED', completedAt: new Date() });
    await this.auditService.record(ctx.organizationId, 'execution_succeeded', { executionId: execution.id, userId: ctx.userId });

    const message = await this.persistOutcomeMessage(ctx, execution.id, plan.summary, true, null, null);
    yield { type: 'execution_done', executionId: execution.id, messageId: message?.id ?? null, summary: plan.summary };
  }

  private async runStep(
    ctx: ToolContext,
    executionId: string,
    key: string,
    step: ExecutionStepDefinition,
    tool: AnyToolDefinition,
    runtime: Record<string, StepRuntimeInfo>,
    order: number,
  ): Promise<{ event: ExecutionStreamEvent; runtime: StepRuntimeInfo; completedForRollback?: CompletedStepForRollback }> {
    const eventData: ExecutionStepEventData = { stepKey: key, toolKey: tool.toolKey, displayName: tool.displayName };

    if (step.condition) {
      const shouldRun = await evaluateCondition(ctx.organizationId, step.condition);
      if (!shouldRun) {
        await updateExecutionStep(executionId, order, { status: 'SKIPPED' });
        return { event: { type: 'step_skipped', step: eventData, reason: 'Condition not met.' }, runtime: { status: 'SKIPPED' } };
      }
    }

    await updateExecutionStep(executionId, order, { status: 'RUNNING' });

    const maxAttempts = step.retry?.maxAttempts ?? 1;
    const backoffMs = step.retry?.backoffMs ?? 0;
    const start = Date.now();

    // Retries are only eligible BEFORE `tool.execute()` has actually
    // returned. `create_project`/`create_task`/`create_meeting` have no
    // idempotency key, so retrying after a real (if non-idempotent) write
    // already happened — e.g. because the immediately-following bookkeeping
    // write to `ExecutionStep` transiently failed — would create a
    // duplicate row, and that first successful result would never have
    // reached `completedForRollback`, so even a full-plan rollback later
    // couldn't clean it up. Once `execute()` returns, this step is
    // committed: the loop exits and is never re-entered, regardless of
    // what happens to the bookkeeping write below.
    let result: unknown;
    let executed = false;
    let lastError = 'Exhausted retry attempts.';

    for (let attempt = 1; attempt <= maxAttempts && !executed; attempt += 1) {
      try {
        const resolvedParams = resolveStepParams(step.params, runtime);
        const schemaCheck = await this.validation.validateParams(tool, resolvedParams);
        if (!schemaCheck.valid) throw new Error(`Invalid parameters: ${schemaCheck.errors.join('; ')}`);

        const { parameters } = tool.schema();
        const parsedParams = parameters.parse(resolvedParams);
        const businessCheck = await tool.validate(ctx, parsedParams);
        if (!businessCheck.valid) throw new Error(businessCheck.errors.join('; '));

        result = await tool.execute(ctx, parsedParams);
        executed = true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts && backoffMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    if (!executed) {
      await updateExecutionStep(executionId, order, { status: 'FAILED', duration: Date.now() - start });
      return { event: { type: 'step_failed', step: eventData, error: lastError }, runtime: { status: 'FAILED' } };
    }

    const durationMs = Date.now() - start;
    // The write already happened — a failure persisting this bookkeeping
    // row must never be treated as "the step failed" (that would re-enter
    // a retry loop that's already closed and duplicate the real write via a
    // higher-level retry, if one existed). It's logged as a best-effort
    // audit note instead, and the step is still reported SUCCEEDED with its
    // result available for rollback.
    try {
      await updateExecutionStep(executionId, order, {
        status: 'SUCCEEDED',
        duration: durationMs,
        result: result as Prisma.InputJsonValue,
      });
    } catch (bookkeepingError) {
      await this.auditService.record(ctx.organizationId, 'step_bookkeeping_write_failed', {
        executionId,
        userId: ctx.userId,
        metadata: {
          stepKey: key,
          error: bookkeepingError instanceof Error ? bookkeepingError.message : String(bookkeepingError),
        },
      });
    }

    return {
      event: { type: 'step_succeeded', step: eventData, durationMs },
      runtime: { status: 'SUCCEEDED', output: result },
      completedForRollback: { stepKey: key, tool, result },
    };
  }

  private async persistOutcomeMessage(
    ctx: ToolContext,
    executionId: string,
    summary: string,
    succeeded: boolean,
    error: string | null,
    rollbackSucceeded: boolean | null,
  ) {
    if (!ctx.conversationId) return null;

    let content: string;
    if (succeeded) {
      content = `Done — ${summary}`;
    } else if (rollbackSucceeded === false) {
      content = `I couldn't finish this — ${summary}. ${error ?? 'An unexpected error occurred.'} The rollback ALSO could not complete — some changes may still be in place. See Execution History for details.`;
    } else {
      content = `I couldn't finish this — ${summary}. ${error ?? 'An unexpected error occurred.'} Any completed steps were rolled back.`;
    }

    return createMessage({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      role: 'ASSISTANT',
      content,
      metadata: {
        executionId,
        status: succeeded ? 'SUCCEEDED' : 'FAILED',
        rollbackStatus: rollbackSucceeded === null ? null : rollbackSucceeded ? 'SUCCEEDED' : 'FAILED',
      },
    });
  }
}
