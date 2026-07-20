import { ValidationError } from '@bond-os/shared';
import type { WorkflowStepType } from '@bond-os/database';

import type { WorkflowStepHandler, WorkflowStepHandlerContext, WorkflowStepOutcome } from '../lib/step-handler';
import { consumeWorkflowStep, type WorkflowDispatchBudget } from '../lib/workflow-dispatch-budget';

const MAX_ITERATIONS = 50;

/**
 * Step types a LOOP body may use — deliberately excludes INVOKE_TOOL/
 * INVOKE_AGENT/WAIT/DELAY/LOOP. A loop iteration must complete
 * synchronously within one `WorkflowRunStep`; allowing a sub-step that
 * itself needs approval or a timer would require making LOOP resumable
 * mid-iteration, tracking which of N items already ran — genuinely new
 * engine complexity out of scope for this release. Documented here, not
 * silently unsupported: an excluded sub-step type fails validation
 * immediately, not at iteration 30 of 50.
 */
const ALLOWED_LOOP_BODY_TYPES = new Set<WorkflowStepType>(['READ_DATA', 'SEARCH_KNOWLEDGE', 'GENERATE_REPORT', 'NOTIFICATION', 'BRANCH']);

interface LoopSubStep {
  stepType: WorkflowStepType;
  params: Record<string, unknown>;
}

function substituteLoopPlaceholders(params: Record<string, unknown>, item: unknown, index: number): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === '$loop.item') resolved[key] = item;
    else if (value === '$loop.index') resolved[key] = index;
    else resolved[key] = value;
  }
  return resolved;
}

/**
 * LOOP — bounded iteration over `params.items`, running `params.subStep`
 * once per item (substituting `$loop.item`/`$loop.index` placeholders in
 * its params). The step-handler registry is imported dynamically, not
 * statically — the registry imports every handler file, including this
 * one; a static import here would be a real self-referential cycle. By the
 * time `execute()` actually runs, module loading has long finished, so the
 * dynamic import resolves immediately in practice.
 */
export const loopHandler: WorkflowStepHandler = {
  stepType: 'LOOP',
  async execute(ctx: WorkflowStepHandlerContext, params, budget: WorkflowDispatchBudget) {
    const items = params.items;
    const subStepRaw = params.subStep;
    if (!Array.isArray(items)) throw new ValidationError('LOOP: "items" must be an array.');
    if (!subStepRaw || typeof subStepRaw !== 'object') throw new ValidationError('LOOP: "subStep" is required.');

    const subStep = subStepRaw as LoopSubStep;
    if (!ALLOWED_LOOP_BODY_TYPES.has(subStep.stepType)) {
      throw new ValidationError(
        `LOOP: step type "${subStep.stepType}" cannot run inside a loop body (allowed: ${Array.from(ALLOWED_LOOP_BODY_TYPES).join(', ')}).`,
      );
    }

    const maxIterations = typeof params.maxIterations === 'number' ? Math.min(params.maxIterations, MAX_ITERATIONS) : MAX_ITERATIONS;
    if (items.length > maxIterations) {
      throw new ValidationError(`LOOP: ${items.length} items exceeds the maximum of ${maxIterations} iterations.`);
    }

    const { getWorkflowStepHandlerRegistry } = await import('../registry');
    const registry = getWorkflowStepHandlerRegistry();
    const subHandler = registry.get(subStep.stepType);
    if (!subHandler) throw new ValidationError(`LOOP: no handler registered for step type "${subStep.stepType}".`);

    const iterationOutputs: Array<{ index: number; output: unknown }> = [];

    for (let index = 0; index < items.length; index += 1) {
      consumeWorkflowStep(budget);
      const iterationParams = substituteLoopPlaceholders(subStep.params, items[index], index);
      const outcome: WorkflowStepOutcome = await subHandler.execute(ctx, iterationParams, budget);

      if (outcome.kind === 'succeeded') {
        iterationOutputs.push({ index, output: outcome.output });
      } else if (outcome.kind === 'skipped') {
        continue;
      } else {
        // waiting_approval / waiting_timer are excluded by ALLOWED_LOOP_BODY_TYPES; a
        // 'failed' sub-step fails the whole loop rather than silently dropping an iteration.
        return { kind: 'failed', error: outcome.kind === 'failed' ? outcome.error : `LOOP: iteration ${index} could not complete synchronously.` };
      }
    }

    return { kind: 'succeeded', output: { iterations: iterationOutputs.length, results: iterationOutputs } };
  },
};
