import { createConversation, getMembership } from '@bond-os/database';
import { ForbiddenError, ValidationError } from '@bond-os/shared';

import { buildAgentContext, createRootDelegationBudget } from '@/features/agents/lib/context';
import { getAgentRegistryService } from '@/features/agents/lib/container';

import type { WorkflowStepHandler, WorkflowStepHandlerContext } from '../lib/step-handler';

/**
 * INVOKE_AGENT — resolves the target agent via the same registry Phase 7's
 * Coordinator/specialists use, builds a real `AgentContext`, and calls
 * `.think()`. If the invoked agent itself proposes a write mid-turn (an
 * `action_proposed` stream event — the same terminal state an INVOKE_TOOL
 * step reaches), this step also transitions to `waiting_approval`; no
 * special-casing needed, it's the same P6 chain either way.
 *
 * A `Conversation` is created for every invocation — `runThinkLoop`'s
 * ACTION-marker handling (Phase 5/7, unmodified) requires `ctx.conversationId`
 * to persist a proposed plan's message and throws a `ValidationError`
 * without one; a design review caught an earlier version of this handler
 * omitting it, which meant an agent that decided to propose a write inside
 * a workflow always failed instead of reaching `waiting_approval` as
 * documented. This also gives the agent's workflow-driven reasoning a real
 * home in the existing chat UI — an auditability win, not just a
 * workaround, matching Phase 8's "Auditable" core principle.
 *
 * Params: `{ agentKey: string, question: string }`.
 */
export const invokeAgentHandler: WorkflowStepHandler = {
  stepType: 'INVOKE_AGENT',
  async execute(ctx: WorkflowStepHandlerContext, params) {
    if (!ctx.ownerId) {
      throw new ValidationError('INVOKE_AGENT requires this workflow to have an owner — set one before publishing.');
    }

    const agentKey = params.agentKey;
    const question = params.question;
    if (typeof agentKey !== 'string' || !agentKey) throw new ValidationError('INVOKE_AGENT: "agentKey" is required.');
    if (typeof question !== 'string' || !question) throw new ValidationError('INVOKE_AGENT: "question" is required.');

    const registry = getAgentRegistryService();
    const agent = registry.get(agentKey);
    if (!agent) throw new ValidationError(`INVOKE_AGENT: unknown agent "${agentKey}".`);

    const membership = await getMembership(ctx.ownerId, ctx.organizationId);
    if (!membership) throw new ForbiddenError('This workflow\'s owner is no longer a member of this organization.');

    const conversation = await createConversation({
      organizationId: ctx.organizationId,
      createdById: ctx.ownerId,
      title: `Workflow run ${ctx.runId}`,
    });

    const agentCtx = await buildAgentContext({
      organizationId: ctx.organizationId,
      userId: ctx.ownerId,
      conversationId: conversation.id,
      role: membership.role,
      agent,
    });
    const agentBudget = createRootDelegationBudget(agent.descriptor.agentKey);

    let answer = '';
    for await (const event of agent.think(agentCtx, question, [], agentBudget)) {
      if (event.type === 'token') answer += event.text;
      if (event.type === 'action_proposed') {
        return { kind: 'waiting_approval', planId: event.planId };
      }
    }

    return { kind: 'succeeded', output: { agentKey, answer } };
  },
};
