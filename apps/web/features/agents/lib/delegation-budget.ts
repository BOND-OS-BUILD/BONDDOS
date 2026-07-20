/**
 * Delegation/handoff safety (Phase 7). A depth counter alone only bounds
 * *termination*, not *waste* — A delegates to B, B delegates back to A,
 * ping-pongs forever inside one open SSE connection (no bytes flushed until
 * a final stream), burning the entire budget before failing with no
 * diagnosable error. `visitedAgentKeys` is the real cycle guard, checked
 * BEFORE every delegate/handoff call — mirroring `apps/web/features/planner/lib/dag.ts`'s
 * own `PlanGraphError` cycle detection (throws immediately on a cycle,
 * doesn't just bound iteration). The depth counter is the backstop for
 * long-but-acyclic chains. Both `toolCallsRemaining` and
 * `delegationDepthRemaining` are DECREMENTED through every recursive call,
 * never reset per hop — otherwise a delegation tree's total LLM-call count
 * scales multiplicatively with depth. See docs/delegation.md.
 */

export class CyclicDelegationError extends Error {
  constructor(agentKey: string, chain: readonly string[]) {
    super(`Cyclic delegation detected: "${agentKey}" is already in this turn's delegation chain (${chain.join(' -> ')}).`);
    this.name = 'CyclicDelegationError';
  }
}

export class DelegationBudgetExhaustedError extends Error {
  constructor() {
    super('Maximum delegation depth reached for this turn.');
    this.name = 'DelegationBudgetExhaustedError';
  }
}

/**
 * `resolveAgent` breaks what would otherwise be a real circular import:
 * `base-agent.ts` (implemented by every concrete agent) needs to look up
 * OTHER agents to delegate/hand off to, but the registry that knows about
 * every concrete agent is built FROM those same agent classes
 * (`agents/registry.ts` imports every `*.agent.ts`, which imports
 * `base-agent.ts`). Neither `base-agent.ts` nor `agent-pipeline.service.ts`
 * import the registry directly — the resolver function is dependency-
 * injected once, by whatever creates the initial budget (an API route, or
 * `GoalService`, both of which already import the registry/container for
 * other reasons), and threaded unchanged through every recursive call.
 */
export interface DelegationBudget {
  toolCallsRemaining: number;
  delegationDepthRemaining: number;
  visitedAgentKeys: Set<string>;
  resolveAgent: (agentKey: string) => import('./agent-definition').AgentDefinition | undefined;
}

export function createDelegationBudget(
  maxToolCalls: number,
  maxDelegationDepth: number,
  rootAgentKey: string,
  resolveAgent: DelegationBudget['resolveAgent'],
): DelegationBudget {
  return {
    toolCallsRemaining: maxToolCalls,
    delegationDepthRemaining: maxDelegationDepth,
    visitedAgentKeys: new Set([rootAgentKey]),
    resolveAgent,
  };
}

/**
 * Throws `CyclicDelegationError` if `targetAgentKey` is already in this
 * turn's ancestor chain, or `DelegationBudgetExhaustedError` if depth is
 * exhausted — call this BEFORE recursing into `runAgentPipeline` for the
 * target, never after. Mutates `budget` (adds the target to
 * `visitedAgentKeys`, decrements `delegationDepthRemaining`) only on
 * success, so a caught/handled error leaves the budget consistent for a
 * caller that wants to try a different agent instead.
 */
export function enterDelegation(budget: DelegationBudget, targetAgentKey: string): void {
  if (budget.visitedAgentKeys.has(targetAgentKey)) {
    throw new CyclicDelegationError(targetAgentKey, Array.from(budget.visitedAgentKeys));
  }
  if (budget.delegationDepthRemaining <= 0) {
    throw new DelegationBudgetExhaustedError();
  }
  budget.visitedAgentKeys.add(targetAgentKey);
  budget.delegationDepthRemaining -= 1;
}
