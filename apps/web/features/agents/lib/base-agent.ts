import type { ChatMessage } from '@bond-os/ai';

import { observeForAgent } from '../services/observation.service';
import { runDelegate, runHandoff, runSummarize, runThinkLoop } from '../services/agent-pipeline.service';
import type {
  AgentAnalysis,
  AgentContext,
  AgentDefinition,
  AgentDescriptor,
  AgentHealthStatus,
  AgentObservation,
  AgentPlanStep,
} from './agent-definition';
import type { AgentStreamEvent } from './agent-message';
import type { DelegationBudget } from './delegation-budget';

const GOAL_PHASE_TEMPLATE: AgentPlanStep['phase'][] = ['PLAN', 'OBSERVE', 'SUGGEST', 'WAIT', 'CONTINUE'];

/**
 * Shared mechanics of the Agent SDK's 9 methods (Phase 7). Concrete agents
 * (`apps/web/features/agents/definitions/*.agent.ts`) only ever override
 * `descriptor`. `think()`/`delegate()`/`handoff()`/`summarize()` are thin
 * calls into the shared pipeline engine (`agent-pipeline.service.ts`) so
 * the actual retrieval/prompt/dispatch logic lives in exactly one place,
 * not duplicated per agent. Deliberately imports `agent-pipeline.service.ts`
 * and `observation.service.ts` directly rather than through
 * `agents/lib/container.ts` — the container composes concrete agents
 * (via `agents/registry.ts`) FROM this class, so this file importing the
 * container back would be a real circular dependency, not just a
 * theoretical one. See docs/base-agent.md.
 */
export abstract class BaseAgent implements AgentDefinition {
  abstract readonly descriptor: AgentDescriptor;

  describe(): AgentDescriptor {
    return this.descriptor;
  }

  async health(): Promise<AgentHealthStatus> {
    const { isAIProviderConfigured, getAIProvider } = await import('@/features/ai/services/ai-provider.service');
    if (!isAIProviderConfigured()) {
      return { healthy: false, registryStatus: 'ACTIVE', providerHealthy: false, message: 'No AI provider configured.' };
    }
    const start = Date.now();
    const status = await getAIProvider().health();
    return {
      healthy: status.healthy,
      registryStatus: 'ACTIVE',
      providerHealthy: status.healthy,
      message: status.message,
      latencyMs: status.latencyMs ?? Date.now() - start,
    };
  }

  /** Deterministic keyword/category overlap against `capabilities`/`supportedKnowledge` — never a fabricated LLM confidence score, matching this codebase's "no hallucinated summaries" principle applied to routing. */
  analyze(input: string): AgentAnalysis {
    const haystack = `${this.descriptor.capabilities.join(' ')} ${this.descriptor.supportedKnowledge.join(' ')}`.toLowerCase();
    const words = input
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2);

    if (words.length === 0) return { relevance: 0, reason: 'No meaningful terms to match.' };

    const matched = words.filter((word) => haystack.includes(word));
    const relevance = matched.length / words.length;
    const reason = matched.length > 0
      ? `Matched: ${Array.from(new Set(matched)).slice(0, 5).join(', ')}`
      : "No overlap with this agent's known domains.";
    return { relevance, reason };
  }

  plan(goalTitle: string): AgentPlanStep[] {
    return GOAL_PHASE_TEMPLATE.map((phase) => ({ phase, description: `${phase}: ${goalTitle}` }));
  }

  async observe(ctx: AgentContext, since?: Date): Promise<AgentObservation[]> {
    return observeForAgent(ctx.organizationId, this.descriptor, since);
  }

  think(ctx: AgentContext, input: string, history: ChatMessage[], budget: DelegationBudget): AsyncGenerator<AgentStreamEvent> {
    return runThinkLoop(this, ctx, input, history, budget);
  }

  async delegate(ctx: AgentContext, targetAgentKey: string, question: string, budget: DelegationBudget): Promise<string> {
    return runDelegate(this, ctx, targetAgentKey, question, budget);
  }

  handoff(
    ctx: AgentContext,
    targetAgentKey: string,
    question: string,
    history: ChatMessage[],
    budget: DelegationBudget,
  ): AsyncGenerator<AgentStreamEvent> {
    return runHandoff(this, ctx, targetAgentKey, question, history, budget);
  }

  async summarize(ctx: AgentContext, pieces: Array<{ agentKey: string; content: string }>): Promise<string> {
    return runSummarize(ctx, pieces);
  }
}
