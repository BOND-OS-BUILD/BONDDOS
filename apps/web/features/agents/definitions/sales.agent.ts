import { ROLES } from '@bond-os/shared';

import type { ToolName } from '@/features/bond/services/tool-calling.service';

import { BaseAgent } from '../lib/base-agent';
import type { AgentDescriptor } from '../lib/agent-definition';

const SUPPORTED_TOOLS: readonly ToolName[] = ['customers', 'emails', 'search', 'graph'];

/** Knows: Customers, CRM, Meetings, Pipeline, Emails, Opportunities. See docs/multi-agent.md. */
const descriptor: AgentDescriptor = {
  agentKey: 'sales_agent',
  version: '1',
  name: 'sales_agent',
  displayName: 'Sales Agent',
  description: 'Specialist in customers, CRM, meetings, pipeline, emails, and opportunities.',
  avatar: 'Handshake',
  category: 'SALES',
  capabilities: ['crm_analysis', 'pipeline_review', 'customer_history'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Customers', 'CRM', 'Meetings', 'Pipeline', 'Emails', 'Opportunities'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};

export class SalesAgent extends BaseAgent {
  readonly descriptor = descriptor;
}

export const salesAgent = new SalesAgent();
