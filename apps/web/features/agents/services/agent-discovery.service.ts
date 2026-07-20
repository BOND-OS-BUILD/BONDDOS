import { requireRole } from '@bond-os/auth';
import { ROLES } from '@bond-os/shared';

import type { AgentHealthStatus } from '../lib/agent-definition';
import { getAgentRegistryService } from '../lib/container';

/**
 * Agent Discovery — maps the live in-memory registry to a plain,
 * serializable shape for `GET /api/agents` and `GET /api/agents/list`
 * (spec: both names honored). Mirrors `tool-discovery.service.ts` exactly.
 * See docs/agent-registry.md.
 */

export interface AvailableAgent {
  agentKey: string;
  version: string;
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  category: string;
  capabilities: string[];
  supportedTools: string[];
  supportedKnowledge: string[];
  priority: number;
  minimumRole: string;
}

export async function listAgentsService(organizationId: string): Promise<AvailableAgent[]> {
  await requireRole(organizationId, ROLES.MEMBER);

  return getAgentRegistryService()
    .list()
    .map((agent) => ({
      agentKey: agent.descriptor.agentKey,
      version: agent.descriptor.version,
      name: agent.descriptor.name,
      displayName: agent.descriptor.displayName,
      description: agent.descriptor.description,
      avatar: agent.descriptor.avatar,
      category: agent.descriptor.category,
      capabilities: agent.descriptor.capabilities,
      supportedTools: [...agent.descriptor.supportedTools],
      supportedKnowledge: agent.descriptor.supportedKnowledge,
      priority: agent.descriptor.priority,
      minimumRole: agent.descriptor.minimumRole,
    }));
}

export async function getAgentService(organizationId: string, agentKey: string): Promise<AvailableAgent | null> {
  const agents = await listAgentsService(organizationId);
  return agents.find((agent) => agent.agentKey === agentKey) ?? null;
}

export interface AgentStatus {
  agentKey: string;
  displayName: string;
  health: AgentHealthStatus;
}

/** `GET /api/agents/status` — every registered agent's real `health()` (which itself checks the configured AI provider) — no fabricated uptime/metrics. */
export async function getAgentStatusService(organizationId: string): Promise<AgentStatus[]> {
  await requireRole(organizationId, ROLES.MEMBER);

  const agents = getAgentRegistryService().list();
  return Promise.all(
    agents.map(async (agent) => ({
      agentKey: agent.descriptor.agentKey,
      displayName: agent.descriptor.displayName,
      health: await agent.health(),
    })),
  );
}
