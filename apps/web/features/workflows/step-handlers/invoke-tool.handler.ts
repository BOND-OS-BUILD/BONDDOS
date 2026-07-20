import { ValidationError } from '@bond-os/shared';

import { proposeAction } from '@/features/planner/services/plan-proposal.service';

import type { WorkflowStepHandler, WorkflowStepHandlerContext } from '../lib/step-handler';

/**
 * INVOKE_TOOL — the ONE way a workflow reaches a write: calls the same
 * `proposeAction()` Mr. Bond's `<<ACTION:...>>` marker and Phase 7's agent
 * ACTION-marker handling already use. Never executes anything itself —
 * always returns `waiting_approval`; the run stays paused until a human
 * approves via the unmodified `/api/execution/[id]/approve`, matching the
 * spec's own diagram exactly: Workflow -> Execution Plan -> P6 Action
 * Engine -> Approval -> Execution.
 *
 * Params: `{ __toolKey: string, __version?: string, ...toolParams }` for a
 * single-tool call, or `{ __plan: { summary, steps } }` for a compound
 * multi-step plan — mirroring `PlanRequestInput`'s own discriminated shape.
 */
export const invokeToolHandler: WorkflowStepHandler = {
  stepType: 'INVOKE_TOOL',
  async execute(ctx: WorkflowStepHandlerContext, params) {
    if (!ctx.ownerId) {
      throw new ValidationError('INVOKE_TOOL requires this workflow to have an owner — set one before publishing.');
    }

    const plan = params.__plan;
    const request =
      plan && typeof plan === 'object'
        ? { kind: 'compound' as const, ...(plan as { summary: string; steps: unknown[] }) }
        : buildSingleToolRequest(params);

    const proposed = await proposeAction({ organizationId: ctx.organizationId, userId: ctx.ownerId }, request as Parameters<typeof proposeAction>[1]);

    return { kind: 'waiting_approval', planId: proposed.plan.id };
  },
};

function buildSingleToolRequest(params: Record<string, unknown>) {
  const { __toolKey: toolKey, __version: version, ...toolParams } = params;
  if (typeof toolKey !== 'string' || !toolKey) throw new ValidationError('INVOKE_TOOL: "__toolKey" is required.');
  return { kind: 'single' as const, toolKey, version: typeof version === 'string' ? version : undefined, params: toolParams };
}
