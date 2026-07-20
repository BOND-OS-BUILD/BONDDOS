import type { AgentCategory, Role } from '@bond-os/database';
import type { ChatMessage } from '@bond-os/ai';

import type { ToolName } from '@/features/bond/services/tool-calling.service';

import type { AgentStreamEvent } from './agent-message';
import type { DelegationBudget } from './delegation-budget';

/**
 * The Agent SDK (Phase 7). Every agent implements exactly these 9 methods —
 * no custom entry points, mirroring Phase 6's own "exactly these 8 methods"
 * rule for `ToolDefinition`. `BaseAgent` (`base-agent.ts`) implements the
 * shared mechanics of every method; concrete agents override persona/
 * `supportedTools`/`supportedKnowledge` and narrow `analyze()`/`think()`
 * refinements only. See docs/base-agent.md.
 */

export interface AgentContext {
  organizationId: string;
  userId: string;
  conversationId?: string;
  organization: { id: string; name: string };
  /** This agent's own allowlist — never the full 9-tool set unless the agent declares it (Coordinator does). */
  availableTools: readonly ToolName[];
  role: Role;
  /**
   * Every other agent available to delegate/hand off to (excluding self) —
   * resolved once per turn by the top-level caller (the one place that
   * safely imports the registry — see `base-agent.ts`'s module-boundary
   * note) and threaded through unchanged, the same way `DelegationBudget`
   * carries `resolveAgent` for looking up ONE target by key.
   */
  availableAgents: AgentDescriptor[];
}

export interface AgentAnalysis {
  /** [0,1], deterministic (keyword/category overlap against `supportedKnowledge`/`capabilities`) — never a fabricated LLM confidence score. */
  relevance: number;
  reason: string;
}

export interface AgentObservation {
  summary: string;
  /** Entity/Message/TimelineEvent ids the observation is about. */
  relatedEntityIds: string[];
}

export interface AgentHealthStatus {
  healthy: boolean;
  registryStatus: 'ACTIVE' | 'DISABLED';
  providerHealthy: boolean;
  message?: string;
  latencyMs?: number;
}

export interface AgentPlanStep {
  phase: 'PLAN' | 'OBSERVE' | 'SUGGEST' | 'WAIT' | 'CONTINUE';
  description: string;
}

export interface AgentDescriptor {
  agentKey: string;
  version: string;
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  category: AgentCategory;
  capabilities: string[];
  supportedTools: readonly ToolName[];
  supportedKnowledge: string[];
  priority: number;
  model?: string;
  temperature?: number;
  maxContext?: number;
  minimumRole: Role;
}

/**
 * Every agent (Coordinator and specialists alike) implements this contract.
 * `think()`/`handoff()` are async generators so `agent-pipeline.service.ts`
 * can turn each yielded event directly into an SSE frame, the same shape
 * `runBondChatPipeline` already uses. `delegate()`/`handoff()` share one
 * underlying mechanism (see `agent-pipeline.service.ts`'s `runAgentPipeline`)
 * — `BaseAgent` provides the shared implementation; concrete agents don't
 * need to (and shouldn't) override either.
 */
export interface AgentDefinition {
  readonly descriptor: AgentDescriptor;

  describe(): AgentDescriptor;
  health(): Promise<AgentHealthStatus>;
  analyze(input: string): AgentAnalysis;
  plan(goalTitle: string): AgentPlanStep[];
  observe(ctx: AgentContext, since?: Date): Promise<AgentObservation[]>;
  /** The core reasoning loop — retrieval, prompt assembly, tool/action/delegation dispatch, streaming. */
  think(ctx: AgentContext, input: string, history: ChatMessage[], budget: DelegationBudget): AsyncGenerator<AgentStreamEvent>;
  /** Consult another agent; the response is accumulated (not streamed to the client) and returned as plain text for the caller to incorporate and keep driving. */
  delegate(ctx: AgentContext, targetAgentKey: string, question: string, budget: DelegationBudget): Promise<string>;
  /** Transfer full control — the target's own `think()` events become this turn's remaining output. */
  handoff(ctx: AgentContext, targetAgentKey: string, question: string, history: ChatMessage[], budget: DelegationBudget): AsyncGenerator<AgentStreamEvent>;
  /** A real LLM synthesis call reconciling multiple agents' answers (Consensus/Parallel) — explicitly surfaces disagreement rather than silently favoring whichever answered last. */
  summarize(ctx: AgentContext, pieces: Array<{ agentKey: string; content: string }>): Promise<string>;
}
