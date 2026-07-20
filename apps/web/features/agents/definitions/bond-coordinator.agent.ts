import { ROLES } from '@bond-os/shared';

import { TOOL_NAMES } from '@/features/bond/services/tool-calling.service';

import { BaseAgent } from '../lib/base-agent';
import type { AgentDescriptor } from '../lib/agent-definition';

/**
 * Mr. Bond, promoted from Phase 5's single assistant to Chief Coordinator
 * (Phase 7 spec: "every request first reaches Mr. Bond"). Its `supportedTools`
 * is the full read-tool set — unchanged capability from Phase 5/6 — and its
 * `think()` (inherited from `BaseAgent`, unmodified) is where a `<<DELEGATE:
 * agentKey>>{"handoff":true}` marker on the very first planning turn hands
 * the entire request to a specialist, which is the whole routing mechanism;
 * no separate router/classifier exists. `/api/bond/chat` (Phase 5, unchanged)
 * still calls `runBondChatPipeline` directly, not this agent — this is the
 * NEW `/api/agents/chat` entry point's default agent when no `agentId` is
 * given. See docs/agents.md, docs/multi-agent.md.
 */
const descriptor: AgentDescriptor = {
  agentKey: 'bond_coordinator',
  version: '1',
  name: 'bond_coordinator',
  displayName: 'Mr. Bond',
  description:
    'Chief Coordinator. Answers general questions directly and routes domain-specific requests to the Project, Sales, Operations, Knowledge, or Finance agent — consulting one for extra context or handing off the whole conversation when their expertise is the better fit.',
  avatar: 'Bot',
  category: 'COORDINATOR',
  capabilities: ['routing', 'general_qa', 'delegation', 'action_proposals'],
  supportedTools: TOOL_NAMES,
  supportedKnowledge: ['General', 'Organization Overview', 'Cross-domain Routing'],
  priority: 100,
  minimumRole: ROLES.MEMBER,
};

export class BondCoordinatorAgent extends BaseAgent {
  readonly descriptor = descriptor;
}

export const bondCoordinatorAgent = new BondCoordinatorAgent();
