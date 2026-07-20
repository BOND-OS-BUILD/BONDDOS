import type { WorkflowStepType } from '@bond-os/database';

import type { GraphStep, RetryPolicy, StepCondition } from '@/features/planner/lib/dag';

/**
 * A `WorkflowDefinition.graph`'s shape (Phase 8) — a flat DAG via
 * `dependsOn`, reusing `dag.ts`'s `computeLayers`/`validatePlanSteps`
 * (generalized to accept this shape, see the `GraphStep` note in dag.ts)
 * instead of a Phase-8-specific graph engine. `stepType` stands in for
 * `ExecutionStepDefinition.toolKey`/`version` — a workflow step names a
 * STEP TYPE (one of the 10 developer-defined handlers), never a tool
 * directly; `INVOKE_TOOL` steps carry the actual `toolKey` inside `params`.
 * See docs/workflow-builder.md.
 */
export interface WorkflowStepDefinition extends GraphStep {
  stepType: WorkflowStepType;
  /** May contain `$steps.<key>.output.<path>` references, resolved via `dag.ts`'s `resolveStepParams` — identical syntax to Phase 6 Plan Graph params. */
  params: Record<string, unknown>;
  condition?: StepCondition;
  retry?: RetryPolicy;
}

export interface WorkflowGraphDefinition {
  steps: WorkflowStepDefinition[];
}
