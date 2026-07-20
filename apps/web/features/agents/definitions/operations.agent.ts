import { ROLES } from '@bond-os/shared';

import type { ToolName } from '@/features/bond/services/tool-calling.service';

import { BaseAgent } from '../lib/base-agent';
import type { AgentDescriptor } from '../lib/agent-definition';

const SUPPORTED_TOOLS: readonly ToolName[] = ['documents', 'timeline', 'analytics', 'search'];

/** Knows: Processes, Execution, Inventory, Documents, Operations. See docs/multi-agent.md. */
const descriptor: AgentDescriptor = {
  agentKey: 'operations_agent',
  version: '1',
  name: 'operations_agent',
  displayName: 'Operations Agent',
  description: 'Specialist in processes, execution tracking, documents, and day-to-day operations.',
  avatar: 'Settings',
  category: 'OPERATIONS',
  capabilities: ['process_analysis', 'document_review', 'operational_reporting'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Processes', 'Execution', 'Inventory', 'Documents', 'Operations'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};

export class OperationsAgent extends BaseAgent {
  readonly descriptor = descriptor;
}

export const operationsAgent = new OperationsAgent();
