import { evaluateCondition, isKnownConditionPredicate } from '@/features/planner/lib/condition-registry';

/**
 * Workflow trigger conditions (Phase 8) — a general AND/OR/NOT/comparison/
 * date tree evaluated against an event, deterministic throughout ("Core
 * Principles: Deterministic execution" — no AI involved). Genuinely more
 * general than `condition-registry.ts`'s own narrow named-predicate registry
 * (built for gating Plan Graph branch steps via a live DB lookup) — this
 * EXTENDS that file for the one leaf type that legitimately needs a DB
 * check (`predicate`), rather than duplicating its AND/OR/NOT logic. See
 * docs/workflow-builder.md.
 */

export interface WorkflowConditionContext {
  organizationId: string;
  eventType: string;
  source: string;
  payload: Record<string, unknown>;
}

export type ComparisonOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'endsWith' | 'in';
export type DateOperator = 'before' | 'after' | 'onOrBefore' | 'onOrAfter';

export interface ComparisonConditionNode {
  type: 'comparison';
  /** Dot-path into the evaluation context, e.g. "payload.status", "organizationId", "eventType" — see `resolveField`. */
  field: string;
  operator: ComparisonOperator;
  value: unknown;
}

export interface DateConditionNode {
  type: 'date';
  field: string;
  operator: DateOperator;
  /** An ISO timestamp, or the literal "now" (resolved at evaluation time — never cached from workflow-creation time). */
  value: string;
}

export interface PredicateConditionNode {
  type: 'predicate';
  /** A name registered in `condition-registry.ts`'s `CONDITIONS` map. */
  predicate: string;
  args: Record<string, unknown>;
  negate?: boolean;
}

export interface AndConditionNode {
  type: 'and';
  nodes: WorkflowConditionNode[];
}

export interface OrConditionNode {
  type: 'or';
  nodes: WorkflowConditionNode[];
}

export interface NotConditionNode {
  type: 'not';
  node: WorkflowConditionNode;
}

export type WorkflowConditionNode =
  | ComparisonConditionNode
  | DateConditionNode
  | PredicateConditionNode
  | AndConditionNode
  | OrConditionNode
  | NotConditionNode;

function resolveField(context: WorkflowConditionContext, field: string): unknown {
  const parts = field.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function compare(actual: unknown, operator: ComparisonOperator, expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
    case 'startsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
    case 'endsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    default: {
      const exhaustive: never = operator;
      return exhaustive;
    }
  }
}

function resolveDateValue(value: string): number {
  return value === 'now' ? Date.now() : new Date(value).getTime();
}

function compareDate(actual: unknown, operator: DateOperator, expected: string): boolean {
  const actualMs = typeof actual === 'string' || actual instanceof Date ? new Date(actual as string | Date).getTime() : NaN;
  if (Number.isNaN(actualMs)) return false;
  const expectedMs = resolveDateValue(expected);

  switch (operator) {
    case 'before':
      return actualMs < expectedMs;
    case 'after':
      return actualMs > expectedMs;
    case 'onOrBefore':
      return actualMs <= expectedMs;
    case 'onOrAfter':
      return actualMs >= expectedMs;
    default: {
      const exhaustive: never = operator;
      return exhaustive;
    }
  }
}

/** Recursively evaluates a `WorkflowConditionNode` tree. Only the `predicate` leaf type touches the database (via `condition-registry.ts`) — every other node is a pure function of `context`. Throws if a `predicate` node names an unregistered predicate, matching `evaluateCondition`'s own "unknown predicate is a build-time-catchable mistake, not a silent false" posture. */
export async function evaluateWorkflowCondition(context: WorkflowConditionContext, node: WorkflowConditionNode): Promise<boolean> {
  switch (node.type) {
    case 'and': {
      for (const child of node.nodes) {
        if (!(await evaluateWorkflowCondition(context, child))) return false;
      }
      return true;
    }
    case 'or': {
      for (const child of node.nodes) {
        if (await evaluateWorkflowCondition(context, child)) return true;
      }
      return false;
    }
    case 'not':
      return !(await evaluateWorkflowCondition(context, node.node));
    case 'comparison':
      return compare(resolveField(context, node.field), node.operator, node.value);
    case 'date':
      return compareDate(resolveField(context, node.field), node.operator, node.value);
    case 'predicate': {
      if (!isKnownConditionPredicate(node.predicate)) {
        throw new Error(`Unknown workflow condition predicate: "${node.predicate}".`);
      }
      return evaluateCondition(context.organizationId, { predicate: node.predicate, args: node.args, negate: node.negate ?? false });
    }
    default: {
      const exhaustive: never = node;
      throw new Error(`Unknown workflow condition node type: ${JSON.stringify(exhaustive)}`);
    }
  }
}
