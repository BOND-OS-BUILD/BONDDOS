import { requireRole } from '@bond-os/auth';
import { createConversation, createMessage, getConversationById } from '@bond-os/database';
import { NotFoundError, ROLES, type AgentChatInput } from '@bond-os/shared';

import { getRecentConversationHistory } from '@/features/bond/services/conversation-memory.service';

import { buildAgentContext, createRootDelegationBudget } from '../lib/context';
import type { AgentStreamEvent } from '../lib/agent-message';
import { getAgentRegistryService } from '../lib/container';

/**
 * `POST /api/agents/chat`'s pipeline — structurally identical to
 * `runBondChatPipeline`'s conversation bootstrapping (get-or-create
 * conversation, persist the USER message, load recent history), then hands
 * off to whichever `AgentDefinition.think()` is selected: an explicit
 * `agentKey`, or the Coordinator (`bond_coordinator`) by default, which may
 * itself hand off to a specialist on its very first planning turn (spec:
 * "every request first reaches Mr. Bond"). See docs/agents.md.
 */
export async function* runAgentChatPipeline(
  organizationId: string,
  userId: string,
  input: AgentChatInput,
): AsyncGenerator<AgentStreamEvent> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);

  let conversationId = input.conversationId;
  if (conversationId) {
    const existing = await getConversationById(conversationId, organizationId);
    if (!existing) throw new NotFoundError('Conversation not found.');
  } else {
    const created = await createConversation({
      organizationId,
      createdById: userId,
      title: input.content.slice(0, 80),
    });
    conversationId = created.id;
  }

  const registry = getAgentRegistryService();
  const agent = input.agentKey ? registry.get(input.agentKey) : registry.getLatest('bond_coordinator');
  if (!agent) {
    throw new NotFoundError(input.agentKey ? `Unknown agent "${input.agentKey}".` : 'Coordinator agent is not registered.');
  }

  await createMessage({ conversationId, organizationId, userId, role: 'USER', content: input.content });

  const ctx = await buildAgentContext({ organizationId, userId, conversationId, role: membership.role, agent });
  const history = await getRecentConversationHistory(organizationId, conversationId, 10);
  const budget = createRootDelegationBudget(agent.descriptor.agentKey);

  yield* agent.think(ctx, input.content, history, budget);
}
