import type { EventData, WorkflowStepType } from '@bond-os/database';

import type { WorkflowDispatchBudget } from './workflow-dispatch-budget';

/**
 * The Step Handler SDK (Phase 8) — mirrors `ToolDefinition`'s "code owns
 * behavior" shape exactly, but for the ~10 fixed step TYPES rather than an
 * open-ended set of tools: a `WorkflowDefinition`'s graph is user data, the
 * handler that interprets each `stepType` is developer code, registered
 * through `WorkflowStepHandlerRegistry` the same way `ToolRegistryService`/
 * `AgentRegistryService` register their own fixed/growing catalogs. See
 * docs/workflow-builder.md.
 */

export interface WorkflowStepHandlerContext {
  organizationId: string;
  /** The workflow's owner — the accountable party for any write this run proposes (mirrors `AgentGoal.createdById`). Required by handlers that call `proposeAction`/build an `AgentContext`; a workflow with no owner cannot register an INVOKE_TOOL/INVOKE_AGENT step (enforced at publish time). */
  ownerId: string | null;
  runId: string;
  workflowDefinitionId: string;
  /** The event that triggered this run — handlers read its payload for parameter substitution beyond what `$steps.*` references cover. */
  triggerEvent: EventData;
}

export type WorkflowStepOutcome =
  | { kind: 'succeeded'; output: Record<string, unknown> }
  | { kind: 'skipped' }
  | { kind: 'waiting_approval'; planId: string }
  | { kind: 'waiting_timer'; waitUntil: Date }
  | { kind: 'failed'; error: string; continueOnFailure?: boolean };

export interface WorkflowStepHandler {
  stepType: WorkflowStepType;
  /**
   * Runs once. Re-entrant handlers (Wait/Delay, Invoke-Tool) may be called
   * again on a later `WorkflowRunStep` resume — see the individual handler
   * files for how each interprets being re-invoked against a step already
   * in `WAITING_TIMER`/`WAITING_APPROVAL`.
   */
  execute(
    ctx: WorkflowStepHandlerContext,
    params: Record<string, unknown>,
    budget: WorkflowDispatchBudget,
  ): Promise<WorkflowStepOutcome>;
}
