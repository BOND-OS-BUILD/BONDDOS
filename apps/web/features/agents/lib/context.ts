import { getOrganizationById } from '@bond-os/database';
import { NotFoundError, type Role } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

import { getAgentRegistry } from '../registry';
import type { AgentContext, AgentDefinition } from './agent-definition';
import { createDelegationBudget, type DelegationBudget } from './delegation-budget';

/**
 * Where `AgentContext.availableAgents` and `DelegationBudget.resolveAgent`
 * actually get resolved from the registry — the "top-level caller" the
 * module-boundary notes in `base-agent.ts`/`delegation-budget.ts` refer to.
 * API routes and `GoalService` call this once per turn/step; neither
 * `base-agent.ts` nor `agent-pipeline.service.ts` import this file or the
 * registry directly. See docs/agents.md.
 */

export interface BuildAgentContextInput {
  organizationId: string;
  userId: string;
  conversationId?: string;
  role: Role;
  agent: AgentDefinition;
}

export async function buildAgentContext(input: BuildAgentContextInput): Promise<AgentContext> {
  const organization = await getOrganizationById(input.organizationId);
  if (!organization) throw new NotFoundError('Organization not found.');

  return {
    organizationId: input.organizationId,
    userId: input.userId,
    conversationId: input.conversationId,
    organization: { id: organization.id, name: organization.name },
    availableTools: input.agent.descriptor.supportedTools,
    role: input.role,
    availableAgents: getAgentRegistry()
      .listOthers(input.agent.descriptor.agentKey)
      .map((other) => other.descriptor),
  };
}

/** A fresh budget for a new top-level turn — `rootAgentKey` seeds `visitedAgentKeys` so the root agent can never delegate back to itself. */
export function createRootDelegationBudget(rootAgentKey: string): DelegationBudget {
  const env = getEnv();
  return createDelegationBudget(env.BOND_MAX_TOOL_CALLS, env.AGENT_MAX_DELEGATION_DEPTH, rootAgentKey, (agentKey) =>
    getAgentRegistry().get(agentKey),
  );
}
