import { requireRole } from '@bond-os/auth';
import { NotFoundError, ROLES, type DelegateRequestInput } from '@bond-os/shared';

import { buildAgentContext, createRootDelegationBudget } from '../lib/context';
import { getAgentRegistryService } from '../lib/container';

export interface DelegateResult {
  fromAgentKey: string;
  toAgentKey: string;
  handoff: boolean;
  answer: string;
}

/**
 * `POST /api/agents/delegate` — explicit admin/debug invocation of one
 * delegation hop (also what the Delegation Graph UI's "replay" affordance
 * calls). Builds a FRESH root `DelegationBudget` seeded with `fromAgentKey`
 * (not a shared one from some other in-flight turn) — this is a standalone
 * one-hop call, not a continuation of an existing conversation's budget.
 * `AgentTimelineEvent`/`Message` side effects are whatever `delegate()`/
 * `handoff()` already produce (see `agent-pipeline.service.ts`) — this
 * service adds no persistence of its own. See docs/delegation.md.
 */
export async function runDelegateRequestService(
  organizationId: string,
  userId: string,
  input: DelegateRequestInput,
): Promise<DelegateResult> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);

  const registry = getAgentRegistryService();
  const fromAgent = registry.get(input.fromAgentKey);
  if (!fromAgent) throw new NotFoundError(`Unknown agent "${input.fromAgentKey}".`);
  if (!registry.get(input.toAgentKey)) throw new NotFoundError(`Unknown agent "${input.toAgentKey}".`);

  const ctx = await buildAgentContext({
    organizationId,
    userId,
    conversationId: input.conversationId,
    role: membership.role,
    agent: fromAgent,
  });
  const budget = createRootDelegationBudget(fromAgent.descriptor.agentKey);

  if (input.handoff) {
    let answer = '';
    for await (const event of fromAgent.handoff(ctx, input.toAgentKey, input.message, [], budget)) {
      if (event.type === 'token') answer += event.text;
    }
    return { fromAgentKey: input.fromAgentKey, toAgentKey: input.toAgentKey, handoff: true, answer };
  }

  const answer = await fromAgent.delegate(ctx, input.toAgentKey, input.message, budget);
  return { fromAgentKey: input.fromAgentKey, toAgentKey: input.toAgentKey, handoff: false, answer };
}
