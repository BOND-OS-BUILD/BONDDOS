import { ROLES } from '@bond-os/shared';

import type { ToolName } from '@/features/bond/services/tool-calling.service';

import { BaseAgent } from '../lib/base-agent';
import type { AgentDescriptor } from '../lib/agent-definition';

const SUPPORTED_TOOLS: readonly ToolName[] = ['analytics', 'search'];

/** Knows: Budgets, Expenses, Invoices, Forecasts, Reports. No accounting integrations. See docs/multi-agent.md. */
const descriptor: AgentDescriptor = {
  agentKey: 'finance_agent',
  version: '1',
  name: 'finance_agent',
  displayName: 'Finance Agent',
  description: 'Specialist in budgets, expenses, invoices, forecasts, and reports. Does not integrate with accounting systems.',
  avatar: 'Landmark',
  category: 'FINANCE',
  capabilities: ['budget_review', 'forecast_analysis', 'reporting'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Budgets', 'Expenses', 'Invoices', 'Forecasts', 'Reports'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};

export class FinanceAgent extends BaseAgent {
  readonly descriptor = descriptor;
}

export const financeAgent = new FinanceAgent();
