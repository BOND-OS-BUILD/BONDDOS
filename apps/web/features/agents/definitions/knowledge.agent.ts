import { ROLES } from '@bond-os/shared';

import type { ToolName } from '@/features/bond/services/tool-calling.service';

import { BaseAgent } from '../lib/base-agent';
import type { AgentDescriptor } from '../lib/agent-definition';

const SUPPORTED_TOOLS: readonly ToolName[] = ['search', 'graph', 'timeline', 'documents', 'analytics'];

/** Knows: Knowledge Graph, Documents, Memory, Search, Entities, Timeline. See docs/multi-agent.md. */
const descriptor: AgentDescriptor = {
  agentKey: 'knowledge_agent',
  version: '1',
  name: 'knowledge_agent',
  displayName: 'Knowledge Agent',
  description: 'Specialist in the knowledge graph, documents, organization memory, search, entities, and timeline.',
  avatar: 'Network',
  category: 'KNOWLEDGE',
  capabilities: ['knowledge_graph_navigation', 'document_search', 'entity_resolution'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Knowledge Graph', 'Documents', 'Memory', 'Search', 'Entities', 'Timeline'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};

export class KnowledgeAgent extends BaseAgent {
  readonly descriptor = descriptor;
}

export const knowledgeAgent = new KnowledgeAgent();
