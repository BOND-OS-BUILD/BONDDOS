import { requireRole } from '@bond-os/auth';
import { getOrganizationById } from '@bond-os/database';
import { NotFoundError, ROLES, type AgentContextQuery } from '@bond-os/shared';

import { countTokensService } from '@/features/ai/services/ai.service';
import { buildPrompt } from '@/features/ai/services/prompt-builder.service';
import { resolveEffectiveAiConfigService } from '@/features/bond/services/ai-settings.service';
import { buildContext } from '@/features/retrieval/services/context-builder.service';

import { getAgentRegistryService } from '../lib/container';

export interface AgentContextPreview {
  agentKey: string;
  displayName: string;
  availableTools: string[];
  supportedKnowledge: string[];
  retrievedSources: Array<{ ref: string; title: string; snippet: string }>;
  estimatedPromptTokens: number;
  truncated: boolean;
}

/**
 * `GET /api/agents/context?q=&agentKey=` — introspection only: shows what
 * `buildContext`/`buildPrompt` would assemble for this question, without
 * ever calling the AI provider or persisting anything. Reuses the exact
 * same retrieval/prompt primitives `agent-pipeline.service.ts` uses, so
 * this preview is never out of sync with what a real turn would actually
 * retrieve. See docs/agents.md.
 */
export async function previewAgentContextService(
  organizationId: string,
  query: AgentContextQuery,
): Promise<AgentContextPreview> {
  await requireRole(organizationId, ROLES.MEMBER);

  const registry = getAgentRegistryService();
  const agent = query.agentKey ? registry.get(query.agentKey) : registry.getLatest('bond_coordinator');
  if (!agent) throw new NotFoundError(query.agentKey ? `Unknown agent "${query.agentKey}".` : 'Coordinator agent is not registered.');

  const organization = await getOrganizationById(organizationId);
  if (!organization) throw new NotFoundError('Organization not found.');

  const config = await resolveEffectiveAiConfigService(organizationId, agent.descriptor.model);
  const tokenBudget = agent.descriptor.maxContext ?? config.contextWindow;

  const context = await buildContext(organizationId, query.q, tokenBudget);
  const built = buildPrompt(context, context.rawResults, { id: organization.id, name: organization.name }, tokenBudget, {
    conversationHistory: [],
  });

  return {
    agentKey: agent.descriptor.agentKey,
    displayName: agent.descriptor.displayName,
    availableTools: [...agent.descriptor.supportedTools],
    supportedKnowledge: agent.descriptor.supportedKnowledge,
    retrievedSources: context.rawResults.map((result) => ({ ref: result.key, title: result.title, snippet: result.snippet })),
    estimatedPromptTokens: countTokensService(built.messages.map((message) => message.content).join('\n')),
    truncated: built.truncated,
  };
}
