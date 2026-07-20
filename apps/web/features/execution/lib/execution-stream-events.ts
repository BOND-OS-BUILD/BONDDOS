/**
 * `/api/execution/[id]/approve`'s SSE event shapes (Phase 6) — mirrors
 * `apps/web/features/bond/lib/stream-events.ts` exactly: imported by both
 * the server engine and client components, zero server-only imports.
 */

export interface ExecutionStepEventData {
  stepKey: string;
  toolKey: string;
  displayName: string;
}

export type ExecutionStreamEvent =
  | { type: 'execution_started'; executionId: string; totalSteps: number }
  | { type: 'step_started'; step: ExecutionStepEventData }
  | { type: 'step_skipped'; step: ExecutionStepEventData; reason: string }
  | { type: 'step_succeeded'; step: ExecutionStepEventData; durationMs: number }
  | { type: 'step_failed'; step: ExecutionStepEventData; error: string }
  | { type: 'rollback_started' }
  | { type: 'rollback_succeeded' }
  | { type: 'rollback_failed'; error: string }
  | { type: 'execution_done'; executionId: string; messageId: string | null; summary: string }
  | { type: 'execution_failed'; executionId: string; messageId: string | null; error: string }
  | { type: 'error'; message: string };
