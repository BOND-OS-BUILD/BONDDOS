/**
 * `/api/bond/chat`'s SSE event shapes — imported by both the server
 * pipeline and client chat components, so it deliberately has zero
 * server-only imports (no `@bond-os/database`/`@bond-os/auth` types).
 */

export interface BondCitation {
  ref: string;
  documentId: string | null;
  documentTitle: string | null;
  page: number | null;
  chunkId: string | null;
  entityId: string | null;
  entityTitle: string | null;
  confidence: number;
}

/** A proposed write plan (Phase 6) — content built entirely from the plan's own validated steps + tool registry metadata, never from raw LLM text. Ends the turn: no `token`/`done` events follow in the same request. See docs/planner.md. */
export interface BondProposedStep {
  key: string;
  toolKey: string;
  displayName: string;
  summary: string;
}

export type BondStreamEvent =
  | { type: 'status'; stage: 'retrieving' | 'planning' | 'tool_call' | 'generating'; detail?: Record<string, unknown> }
  | { type: 'token'; text: string }
  | { type: 'citations'; citations: BondCitation[] }
  | { type: 'suggestions'; questions: string[] }
  | {
      type: 'done';
      conversationId: string;
      messageId: string;
      model: string;
      tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
    }
  | {
      // No `executionId` here — a `ToolExecution` row only exists after
      // approval succeeds (see `ExecutionService.executeApprovedPlan`).
      // `planId` is what `POST /api/execution/[id]/approve` keys by.
      type: 'action_proposed';
      conversationId: string;
      messageId: string;
      planId: string;
      summary: string;
      steps: BondProposedStep[];
      requiredRole: string;
      estimatedTimeMs: number;
      rollbackStrategy: string;
      expiresAt: string;
    }
  | { type: 'error'; message: string };
