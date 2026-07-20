/**
 * Synchronous event-dispatch safety (Phase 8) — mirrors
 * `apps/web/features/agents/lib/delegation-budget.ts` exactly, for the same
 * reason: a step count/time budget alone bounds waste, but a cycle guard is
 * what actually stops a loop before it runs at all. `publishEvent()`
 * dispatches synchronously and in-process (see docs/event-bus.md) — a
 * workflow whose own step chain eventually produces an `Event` matching the
 * SAME `WorkflowDefinition` again (directly, or transitively through
 * several other workflows) is an ordinary-user-reachable infinite
 * synchronous loop, not a hypothetical: e.g. a workflow that fires on
 * `AI_INSIGHT` and itself calls `InsightService.record()` as one of its own
 * effects. `visitedWorkflowDefinitionIds` is checked BEFORE a candidate
 * `WorkflowRun` is started, mutated only on success (mirrors
 * `enterDelegation`'s "throws before mutating on failure" contract) so a
 * caught/handled cycle leaves the budget consistent. `stepsRemaining`/
 * `deadlineAt` are the backstop for long-but-acyclic chains — decremented
 * through every nested dispatch, never reset per hop, matching
 * `DelegationBudget`'s own "never reset per hop" rule that prevents
 * multiplicative blowup.
 */

export class WorkflowCyclicDispatchError extends Error {
  constructor(workflowDefinitionId: string, chain: readonly string[]) {
    super(
      `Cyclic workflow dispatch detected: workflow "${workflowDefinitionId}" is already in this event's dispatch chain (${chain.join(' -> ')}).`,
    );
    this.name = 'WorkflowCyclicDispatchError';
  }
}

export class WorkflowDispatchBudgetExhaustedError extends Error {
  constructor() {
    super('Maximum synchronous workflow dispatch steps/time reached for this event.');
    this.name = 'WorkflowDispatchBudgetExhaustedError';
  }
}

export interface WorkflowDispatchBudget {
  stepsRemaining: number;
  /** `Date.now()`-comparable deadline — checked (not just decremented) at every step boundary so a handful of slow steps can't quietly exceed the wall-clock budget even while `stepsRemaining` is still positive. */
  deadlineAt: number;
  visitedWorkflowDefinitionIds: Set<string>;
}

export function createWorkflowDispatchBudget(maxSteps: number, maxMs: number): WorkflowDispatchBudget {
  return {
    stepsRemaining: maxSteps,
    deadlineAt: Date.now() + maxMs,
    visitedWorkflowDefinitionIds: new Set(),
  };
}

/**
 * Throws `WorkflowCyclicDispatchError` if `workflowDefinitionId` is already
 * in this dispatch chain — call BEFORE starting a `WorkflowRun` for it,
 * never after. Mutates `budget.visitedWorkflowDefinitionIds` only on
 * success.
 */
export function enterWorkflowDispatch(budget: WorkflowDispatchBudget, workflowDefinitionId: string): void {
  if (budget.visitedWorkflowDefinitionIds.has(workflowDefinitionId)) {
    throw new WorkflowCyclicDispatchError(workflowDefinitionId, Array.from(budget.visitedWorkflowDefinitionIds));
  }
  budget.visitedWorkflowDefinitionIds.add(workflowDefinitionId);
}

/** Call once per synchronous step executed (any step type, not just Invoke-Tool/Agent) — throws once the step count or wall-clock deadline is exhausted, never silently continues past either. */
export function consumeWorkflowStep(budget: WorkflowDispatchBudget): void {
  if (budget.stepsRemaining <= 0 || Date.now() >= budget.deadlineAt) {
    throw new WorkflowDispatchBudgetExhaustedError();
  }
  budget.stepsRemaining -= 1;
}
