import type { PlanRequest, RawStepRequest } from '../lib/plan-request';

/**
 * Intent Detection (Phase 6) — folded into Mr. Bond's existing planning
 * loop (`rag-pipeline.service.ts`), not a separate up-front classifier: that
 * loop already costs a non-streamed `generate()` call on every turn
 * regardless (see docs/rag.md), so a dedicated classifier would be a wholly
 * redundant LLM round-trip. A single-line JSON payload, same constraint as
 * Phase 5's `<<TOOL:...>>` marker — kept in a completely separate file/regex
 * from `apps/web/features/bond/services/tool-calling.service.ts`, which is
 * NOT modified by this phase. See docs/planner.md.
 *
 * Two shapes:
 *  - `<<ACTION:tool_key>>{...params}` — a single-tool action.
 *  - `<<ACTION:plan>>{"summary":"...","steps":[...]}` — a compound,
 *    multi-step plan the model proposes directly (its `dependsOn`/`params`
 *    `$steps.*` references get validated and structured by
 *    `PlannerService`, never trusted as-is — see docs/planner.md).
 */

const ACTION_MARKER = /<<ACTION:([a-zA-Z_]+)>>\s*(\{[^\n]*\})/;

export function containsActionMarker(text: string): boolean {
  return ACTION_MARKER.test(text);
}

function isRawStepRequest(value: unknown): value is RawStepRequest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.key === 'string' &&
    typeof record.toolKey === 'string' &&
    typeof record.params === 'object' &&
    record.params !== null &&
    !Array.isArray(record.params) &&
    (record.dependsOn === undefined || (Array.isArray(record.dependsOn) && record.dependsOn.every((d) => typeof d === 'string')))
  );
}

/** Malformed markers (unknown JSON, wrong shape) are treated as "no action call" — the text is used as prose rather than crashing the pipeline, matching `parseToolCall`'s existing posture in tool-calling.service.ts. */
export function parseActionCall(text: string): PlanRequest | null {
  const match = ACTION_MARKER.exec(text);
  if (!match) return null;

  const [, key, payloadJson] = match;
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson!);
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;

  if (key === 'plan') {
    const record = payload as Record<string, unknown>;
    if (typeof record.summary !== 'string' || !Array.isArray(record.steps) || !record.steps.every(isRawStepRequest)) {
      return null;
    }
    return { kind: 'compound', summary: record.summary, steps: record.steps as RawStepRequest[] };
  }

  return { kind: 'single', toolKey: key!, params: payload as Record<string, unknown> };
}
