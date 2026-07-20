import { prisma } from '../client';
import type { AgentCategory, AgentRegistryStatus, Prisma, Role } from '../generated/index.js';

/**
 * Registered-agent metadata (Phase 7). NOT organization-scoped — a
 * registered agent applies to every organization. The agent's actual
 * BEHAVIOR (the 9 SDK methods) lives in code (apps/web/features/agents/)
 * and is never read from this table; these rows exist for Agent Discovery
 * and historical/introspection display. See docs/agent-registry.md.
 */

export interface AgentMetadata {
  id: string;
  agentKey: string;
  version: string;
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  category: AgentCategory;
  capabilities: unknown;
  supportedTools: unknown;
  supportedKnowledge: unknown;
  priority: number;
  model: string | null;
  temperature: number | null;
  maxContext: number | null;
  status: AgentRegistryStatus;
  minimumRole: Role;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertAgentData {
  agentKey: string;
  version: string;
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  category: AgentCategory;
  capabilities: Prisma.InputJsonValue;
  supportedTools: Prisma.InputJsonValue;
  supportedKnowledge: Prisma.InputJsonValue;
  priority: number;
  model?: string | null;
  temperature?: number | null;
  maxContext?: number | null;
  status: AgentRegistryStatus;
  minimumRole: Role;
}

/** Idempotent upsert by `[agentKey, version]` — called once per registered agent when `AgentRegistryService` is first constructed each process lifetime. */
export async function upsertAgent(data: UpsertAgentData): Promise<AgentMetadata> {
  return prisma.agent.upsert({
    where: { agentKey_version: { agentKey: data.agentKey, version: data.version } },
    create: data,
    update: data,
  });
}

export async function listAgents(): Promise<AgentMetadata[]> {
  return prisma.agent.findMany({ orderBy: [{ priority: 'desc' }, { agentKey: 'asc' }] });
}

export async function getAgentByKey(agentKey: string, version: string): Promise<AgentMetadata | null> {
  return prisma.agent.findUnique({ where: { agentKey_version: { agentKey, version } } });
}

export async function getAgentById(id: string): Promise<AgentMetadata | null> {
  return prisma.agent.findUnique({ where: { id } });
}
