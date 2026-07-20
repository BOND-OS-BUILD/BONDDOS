import { bondCoordinatorAgent } from './definitions/bond-coordinator.agent';
import { financeAgent } from './definitions/finance.agent';
import { knowledgeAgent } from './definitions/knowledge.agent';
import { operationsAgent } from './definitions/operations.agent';
import { projectAgent } from './definitions/project.agent';
import { salesAgent } from './definitions/sales.agent';
import type { AgentDefinition } from './lib/agent-definition';
import { AgentRegistryService } from './services/agent-registry.service';

/**
 * The ONLY file in this codebase that imports every concrete agent
 * definition — mirrors `apps/web/features/tools/registry.ts` exactly.
 * `agents/lib/base-agent.ts` and `agents/services/agent-pipeline.service.ts`
 * never import this file (that would be the circular dependency documented
 * in `delegation-budget.ts`); only top-level callers (API routes,
 * `GoalService`) that already need the full agent list import it, then
 * thread `resolveAgent`/`availableAgents` down as plain data. See
 * docs/agent-registry.md.
 */
const ALL_AGENTS: AgentDefinition[] = [bondCoordinatorAgent, projectAgent, salesAgent, operationsAgent, knowledgeAgent, financeAgent];

let instance: AgentRegistryService | undefined;

/** Lazily builds and registers every known agent exactly once per process — same composition-root ethos as `getToolRegistry()`. */
export function getAgentRegistry(): AgentRegistryService {
  if (!instance) {
    instance = new AgentRegistryService();
    for (const agent of ALL_AGENTS) {
      instance.register(agent);
    }
  }
  return instance;
}
