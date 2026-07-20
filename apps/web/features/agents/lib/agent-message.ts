import type { BondCitation } from '@/features/bond/lib/stream-events';

/**
 * Structured agent-to-agent communication (Phase 7 spec: "Agents never
 * exchange free-form prompts"). `AgentMessage` is a discriminated union
 * describing every shape one agent (or the pipeline) can hand another —
 * never persisted as-is; the `AgentTimelineEvent` it produces is what's
 * stored (see `agent-timeline.service.ts`), and only ever as a structured,
 * allowlisted DTO — never this message's raw text. See docs/agents.md.
 */

export type AgentMessage =
  | { type: 'Request'; fromAgentKey: string | null; content: string }
  | { type: 'Response'; fromAgentKey: string; content: string; citations?: BondCitation[] }
  | { type: 'Delegation'; fromAgentKey: string; toAgentKey: string; question: string; handoff: boolean }
  | { type: 'Observation'; fromAgentKey: string; summary: string; relatedEntityIds: string[] }
  | { type: 'Summary'; fromAgentKey: string; content: string; sourceAgentKeys: string[] }
  | { type: 'Plan'; fromAgentKey: string; goalTitle: string; steps: string[] }
  | { type: 'Error'; fromAgentKey: string | null; message: string }
  | { type: 'ApprovalRequest'; fromAgentKey: string; planId: string; summary: string };

/**
 * `think()`/`handoff()`'s streamed output — the agent-layer analogue of
 * `apps/web/features/bond/lib/stream-events.ts`'s `BondStreamEvent`. Kept as
 * a distinct type (not a reuse of `BondStreamEvent`) since it needs an
 * `agentKey` on every variant — which agent is actually speaking matters
 * once more than one agent can answer in a turn.
 */
export type AgentStreamEvent =
  | { type: 'status'; agentKey: string; stage: 'retrieving' | 'planning' | 'tool_call' | 'delegating' | 'generating'; detail?: Record<string, unknown> }
  | { type: 'token'; agentKey: string; text: string }
  | { type: 'citations'; agentKey: string; citations: BondCitation[] }
  | { type: 'suggestions'; agentKey: string; questions: string[] }
  | {
      type: 'done';
      agentKey: string;
      conversationId: string;
      messageId: string;
      model: string;
      tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
    }
  | {
      type: 'action_proposed';
      agentKey: string;
      conversationId: string;
      messageId: string;
      planId: string;
      summary: string;
      steps: Array<{ key: string; toolKey: string; displayName: string; summary: string }>;
      requiredRole: string;
      estimatedTimeMs: number;
      rollbackStrategy: string;
      expiresAt: string;
    }
  | { type: 'error'; agentKey: string | null; message: string };
