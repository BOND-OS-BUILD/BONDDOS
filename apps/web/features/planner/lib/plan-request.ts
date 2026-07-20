import type { RetryPolicy } from './dag';

/**
 * The already-parsed shape `intent-detection.service.ts` hands to
 * `PlannerService.buildPlan()` — parsing the `<<ACTION:...>>` marker text
 * is a separate concern from planning, mirroring how Phase 5's
 * `parseToolCall`/`executeToolCall` are kept separate. See docs/planner.md.
 */

export interface RawStepRequest {
  key: string;
  toolKey: string;
  version?: string;
  params: Record<string, unknown>;
  dependsOn?: string[];
  retry?: RetryPolicy;
}

export type PlanRequest =
  | { kind: 'single'; toolKey: string; version?: string; params: Record<string, unknown> }
  | { kind: 'compound'; summary: string; steps: RawStepRequest[] };
