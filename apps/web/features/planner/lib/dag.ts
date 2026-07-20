/**
 * The Plan Graph (Phase 6, spec's "Plan Graph must support Sequential/
 * Parallel/Conditional/Retry"). A flat list of `ExecutionStepDefinition`s
 * forming a DAG via `dependsOn`, not a nested tree grammar — see
 * docs/planner.md for why. This file is generic graph/reference-resolution
 * logic only: no Project/Task/Customer knowledge anywhere in it.
 */

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export interface StepCondition {
  /** A key into `apps/web/features/planner/lib/condition-registry.ts`. */
  predicate: string;
  args: Record<string, unknown>;
  negate?: boolean;
}

export interface ExecutionStepDefinition {
  /** Stable within this plan only — not a DB id. */
  key: string;
  toolKey: string;
  version: string;
  /** May contain `$steps.<key>.output.<path>` references, optionally chained with ` ?? ` fallbacks — resolved just before this step runs, never at plan-build time. */
  params: Record<string, unknown>;
  dependsOn: string[];
  condition?: StepCondition;
  retry?: RetryPolicy;
}

export interface PlanGraph {
  /** Each inner array is a set of step keys with no interdependency — the engine runs them via `Promise.all` (parallel); layers themselves run in sequence. */
  layers: string[][];
}

export class PlanGraphError extends Error {}

/** The minimal shape `validatePlanSteps`/`computeLayers` actually need — neither touches `toolKey`/`params`/anything else, so both are generic over this rather than hardcoded to `ExecutionStepDefinition`. This is what lets Phase 8's `WorkflowStepDefinition` (a different shape — `stepType` instead of `toolKey`/`version`) reuse the same graph-layering algorithm instead of forking it; existing Phase 6 callers are unaffected since `ExecutionStepDefinition` already satisfies this constraint and `T` is inferred automatically. */
export interface GraphStep {
  key: string;
  dependsOn: string[];
}

/** Throws `PlanGraphError` on duplicate keys, a `dependsOn` reference to a step that doesn't exist in this plan, or a dependency cycle. */
export function validatePlanSteps<T extends GraphStep>(steps: T[]): void {
  const keys = new Set<string>();
  for (const step of steps) {
    if (keys.has(step.key)) throw new PlanGraphError(`Duplicate step key: "${step.key}".`);
    keys.add(step.key);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!keys.has(dep)) {
        throw new PlanGraphError(`Step "${step.key}" depends on unknown step "${dep}".`);
      }
    }
  }
}

/**
 * Topologically sorts `steps` into layers via Kahn's algorithm: a step
 * joins a layer once every step it `dependsOn` has already been placed in
 * an earlier layer. Throws `PlanGraphError` if a cycle prevents any
 * progress. Two steps at the same layer with complementary `condition`s
 * (the IF-EXISTS/ELSE pattern — see docs/planner.md) is how conditional
 * branching is represented; this function doesn't need to know that, it
 * just sees two steps with identical `dependsOn`.
 */
export function computeLayers<T extends GraphStep>(steps: T[]): PlanGraph {
  validatePlanSteps(steps);

  const byKey = new Map(steps.map((step) => [step.key, step]));
  const resolved = new Set<string>();
  const remaining = new Set(byKey.keys());
  const layers: string[][] = [];

  while (remaining.size > 0) {
    const layer = Array.from(remaining).filter((key) => {
      const step = byKey.get(key)!;
      return step.dependsOn.every((dep) => resolved.has(dep));
    });

    if (layer.length === 0) {
      throw new PlanGraphError(`Cycle detected among steps: ${Array.from(remaining).join(', ')}.`);
    }

    layers.push(layer);
    for (const key of layer) {
      resolved.add(key);
      remaining.delete(key);
    }
  }

  return { layers };
}

/** Statuses a step can be in when it's done running, one way or another — the set that satisfies a downstream `dependsOn`. A downstream step waits for its dependencies to reach ANY of these, not specifically `SUCCEEDED`; otherwise a step depending on two complementary conditional branches (one of which is always `SKIPPED`) would deadlock forever. */
const TERMINAL_STEP_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'SKIPPED', 'ROLLED_BACK']);

export function isTerminalStepStatus(status: string): boolean {
  return TERMINAL_STEP_STATUSES.has(status);
}

export interface StepRuntimeInfo {
  status: string;
  output?: unknown;
}

const REFERENCE_PATTERN = /^\$steps\.([a-zA-Z0-9_]+)\.output(\.[a-zA-Z0-9_.]+)?$/;

function resolveSingleReference(
  expression: string,
  steps: Record<string, StepRuntimeInfo>,
): { found: boolean; value: unknown } {
  const match = REFERENCE_PATTERN.exec(expression.trim());
  if (!match) return { found: false, value: undefined };

  const [, stepKey, path] = match;
  const info = steps[stepKey!];
  if (!info || info.output === undefined || info.output === null) return { found: false, value: undefined };
  if (!path) return { found: true, value: info.output };

  let current: unknown = info.output;
  for (const segment of path.slice(1).split('.')) {
    if (current === null || typeof current !== 'object') return { found: false, value: undefined };
    current = (current as Record<string, unknown>)[segment];
  }
  return current === undefined ? { found: false, value: undefined } : { found: true, value: current };
}

/**
 * Resolves one param value. Non-reference values (anything not starting
 * with `$steps.`) pass through unchanged. A reference may chain fallbacks
 * with ` ?? ` — e.g. `$steps.update_x.output.id ?? $steps.create_x.output.id`
 * for the conditional IF-EXISTS/ELSE pattern, where exactly one branch
 * actually ran and produced output. Throws if every alternative fails to
 * resolve (e.g. every referenced dependency was skipped), rather than
 * silently passing `undefined` through to a tool's `execute()`.
 */
export function resolveParamValue(value: unknown, steps: Record<string, StepRuntimeInfo>): unknown {
  if (typeof value !== 'string' || !value.trimStart().startsWith('$steps.')) return value;

  const alternatives = value.split('??').map((part) => part.trim());
  for (const alternative of alternatives) {
    const resolved = resolveSingleReference(alternative, steps);
    if (resolved.found) return resolved.value;
  }

  throw new Error(`Could not resolve parameter reference: "${value}" — every referenced step was skipped or produced no matching output.`);
}

export function resolveStepParams(
  params: Record<string, unknown>,
  steps: Record<string, StepRuntimeInfo>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    resolved[key] = resolveParamValue(value, steps);
  }
  return resolved;
}
