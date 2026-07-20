import { upsertAgent } from '@bond-os/database';

import type { AgentDefinition } from '../lib/agent-definition';

/**
 * The single source of truth for which agents exist (Phase 7) — mirrors
 * `ToolRegistryService` exactly. Concrete agent modules never register
 * themselves globally; `apps/web/features/agents/registry.ts` is the ONLY
 * file that imports every concrete agent and calls `register()`. Every
 * other caller (API routes, `GoalService`, `DelegationBudget.resolveAgent`)
 * only ever calls `get()`/`list()` on an instance of this class. See
 * docs/agent-registry.md.
 */
export class AgentRegistryService {
  private readonly agents = new Map<string, AgentDefinition>();
  private syncPromise: Promise<void> | null = null;

  register(agent: AgentDefinition): void {
    this.agents.set(this.key(agent.descriptor.agentKey, agent.descriptor.version), agent);
  }

  get(agentKey: string, version?: string): AgentDefinition | undefined {
    if (version) return this.agents.get(this.key(agentKey, version));
    return this.getLatest(agentKey);
  }

  getLatest(agentKey: string): AgentDefinition | undefined {
    const candidates = this.list().filter((agent) => agent.descriptor.agentKey === agentKey);
    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) => Number(b.descriptor.version) - Number(a.descriptor.version))[0];
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values()).sort((a, b) => b.descriptor.priority - a.descriptor.priority);
  }

  /** Every OTHER registered agent (excluding `excludeAgentKey`) — what `AgentContext.availableAgents` is built from once per turn. */
  listOthers(excludeAgentKey: string): AgentDefinition[] {
    return this.list().filter((agent) => agent.descriptor.agentKey !== excludeAgentKey);
  }

  /** Idempotently upserts every registered agent's static metadata into the `Agent` table — same lazy-once-per-process ethos as `ToolRegistryService.syncToDatabase`. The DB row is a queryable metadata snapshot; behavior always lives in code. */
  async syncToDatabase(): Promise<void> {
    if (!this.syncPromise) {
      this.syncPromise = Promise.all(
        this.list().map((agent) =>
          upsertAgent({
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
            model: agent.descriptor.model ?? null,
            temperature: agent.descriptor.temperature ?? null,
            maxContext: agent.descriptor.maxContext ?? null,
            status: 'ACTIVE',
            minimumRole: agent.descriptor.minimumRole,
          }),
        ),
      ).then(() => undefined);
    }
    await this.syncPromise;
  }

  private key(agentKey: string, version: string): string {
    return `${agentKey}@${version}`;
  }
}
