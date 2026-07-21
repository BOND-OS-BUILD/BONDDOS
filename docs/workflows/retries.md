# Retries, Dead Letters & Rollback

## Scope

What happens to a `WorkflowRunStep` and its containing `WorkflowRun` when a step fails — the
`RetryPolicy` shape a workflow step can declare (and the driver's current, unimplemented relationship
to it), why a "failed" workflow step is a plain queryable database row rather than a literal
dead-letter queue, how `workflow-run.service.ts`'s `failRun` reuses Phase 6's `RollbackService`
unmodified to compensate for a partially-succeeded run, the manual-intervention fallback when a step's
underlying tool doesn't support rollback, and `NOTIFICATION`'s unique `continueOnFailure` behavior — the
one step type that doesn't fail its run by default.

## `RetryPolicy`: declared, not currently consumed by the driver

`WorkflowStepDefinition.retry` reuses the identical `RetryPolicy` shape Phase 6's Plan Graph already
defines and validates (`packages/shared/src/schemas/execution.ts`):

```ts
export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5),
  backoffMs: z.number().int().min(0).max(60_000),
});

export interface WorkflowStepDefinition extends GraphStep {
  stepType: WorkflowStepType;
  params: Record<string, unknown>;
  condition?: StepCondition;
  retry?: RetryPolicy;
}
```

`WorkflowRunStep.attempt` (`Int @default(1)`) is the schema's own place to record which attempt a row
represents, mirroring the field's role everywhere else in this codebase. State this precisely, because
it's a real gap rather than a nuance: **`driveWorkflowRun` (`workflow-run.service.ts`) does not
currently read `stepDef.retry` at all, and never increments `WorkflowRunStep.attempt`.** This is unlike
Phase 6's `ExecutionService.runStep`, which does implement a real per-attempt retry loop
(`for (let attempt = 1; attempt <= maxAttempts && !executed; attempt += 1) { ... }`) against
`ExecutionStepDefinition.retry`. A workflow step that fails today fails on its first and only attempt,
regardless of what `retry` value its `WorkflowStepDefinition` declares — the type and the
persisted-schema column exist (matching `retryPolicySchema`'s shape exactly, so a future driver change
has a validated, already-proven shape to consume), but the workflow driver's `failed`-outcome path goes
straight to failing the run (or, for `NOTIFICATION`, continuing) rather than re-attempting. The Visual
Builder's own canvas surfaces this shape honestly too — a step's `retry` (and `condition`) are shown as
a read-only JSON block in the node-edit panel, never an editable field, since editing it would imply the
driver acts on it (see [Builder](./builder.md)).

## "Dead letter" = queryable `FAILED` rows, not a literal queue

There is no dead-letter queue, no separate failed-message store, no retry-queue infrastructure anywhere
in this phase. A workflow step that fails is simply a `WorkflowRunStep` row whose `status` column is
`FAILED`, with its `error` column holding the failure message and `completedAt` set — an ordinary row
in the same table every other step's history lives in, findable with an ordinary Prisma query
(`WHERE status = 'FAILED'`), not a specialized inspection tool. This is the same posture this codebase
takes everywhere else a "what do we do with failures" question comes up: `ExecutionStep`/
`ToolExecution.status = 'FAILED'` rows are Phase 6's own dead-letter equivalent; `RollbackRecord.status
= 'FAILED'` rows are the record of a rollback that itself didn't fully succeed. Phase 8 adds nothing
new to this pattern — it reuses it.

Concretely, three tables together give a complete, queryable picture of every workflow failure, with no
additional infrastructure:

- **`WorkflowRunStep`** — which step, in which run, failed, and its own `error` string.
- **`WorkflowRun`** — `status = 'FAILED'`, with the run's own top-level `error` set by `failRun`.
- **`ToolExecution`/`RollbackRecord`** (for a failed `INVOKE_TOOL` step specifically) — the underlying
  Phase 6 execution/rollback attempt this workflow step's plan produced, unmodified and independently
  queryable exactly as it would be for a human-initiated plan.

## `failRun`: reusing `RollbackService`, not a new compensation engine

`driveWorkflowRun`'s failure branch, when any non-`NOTIFICATION` step's outcome is `failed`, calls
`failRun`:

```ts
/**
 * Rolls back every prior SUCCEEDED INVOKE_TOOL step of this run, in reverse
 * order, via the existing, unmodified `RollbackService` — direct reuse of
 * Phase 6's rollback mechanism per step's own `ExecutionPlan`, not a new
 * one. A step whose tool doesn't support rollback is recorded as requiring
 * manual intervention rather than silently reported as reversed, mirroring
 * the Phase 6 fix where a zero-row rollback match throws instead of
 * reporting false success.
 */
async function failRun(
  definition: WorkflowDefinitionData,
  run: WorkflowRunData,
  failedStepKey: string,
  error: string,
  priorSteps: WorkflowRunStepData[],
): Promise<void> {
  await updateWorkflowRunStatus(run.id, definition.organizationId, { status: 'FAILED', error, completedAt: new Date() });

  const rollbackPolicy = definition.rollbackPolicy as { enabled?: boolean } | null;
  const shouldRollback = rollbackPolicy?.enabled !== false;
  const invokeToolSteps = priorSteps.filter((step) => step.stepType === 'INVOKE_TOOL' && step.status === 'SUCCEEDED' && step.planId);

  if (shouldRollback && invokeToolSteps.length > 0 && definition.ownerId) {
    await rollbackWorkflowSteps(definition.organizationId, definition.ownerId, invokeToolSteps);
  }

  const { publishEvent } = await import('./event-bus.service');
  await publishEvent({ organizationId: definition.organizationId, eventType: 'workflow.notification', source: 'SYSTEM', payload: { runId: run.id, workflowDefinitionId: definition.id, status: 'failed', failedStepKey, error } });
}
```

```mermaid
flowchart TD
    A["A step's outcome is 'failed'"] --> B{continueOnFailure?<br/>(only NOTIFICATION sets it)}
    B -- yes --> C["mark step FAILED, run keeps going"]
    B -- no / absent --> D["failRun()"]
    D --> E["WorkflowRun.status = FAILED<br/>(never ROLLED_BACK)"]
    D --> F{"rollbackPolicy.enabled !== false?<br/>(opt-out, default true)"}
    F -- no --> H["publish workflow.notification (status: failed)"]
    F -- yes --> G["rollbackWorkflowSteps():<br/>every prior SUCCEEDED INVOKE_TOOL step,<br/>reverse order, via RollbackService"]
    G --> H
```

`WorkflowRun.status` transitions straight to `FAILED` — not the `WorkflowRunStatus.ROLLED_BACK` value
the enum also defines. Unlike `ToolExecution`'s own status column (which distinguishes `ROLLED_BACK`
from `FAILED` depending on whether the rollback attempt itself succeeded), `WorkflowRun.status` does
not currently make that same distinction — a run whose rollback fully succeeds and one whose rollback
partially fails both end up `FAILED` at the `WorkflowRun` level. Whether the compensating rollback
actually succeeded is recorded one layer down, in the same `RollbackRecord`/`ToolExecution.rollbackStatus`
rows Phase 6 already writes for each rolled-back `INVOKE_TOOL` step's own plan — see below.

`rollbackPolicy` is a `WorkflowDefinition`-level `Json` column, opt-out rather than opt-in:
`shouldRollback` is `true` unless the definition explicitly sets `{ enabled: false }` — a workflow
author has to deliberately disable compensation, it isn't something they have to remember to turn on.

## `rollbackWorkflowSteps`: direct reuse of `RollbackService`, per step's own plan

```ts
async function rollbackWorkflowSteps(organizationId: string, ownerId: string, steps: WorkflowRunStepData[]): Promise<void> {
  const ctx: ToolContext = { organizationId, userId: ownerId };
  const toolRegistry = getToolRegistryService();
  const rollbackService = getRollbackService();

  for (const step of [...steps].reverse()) {
    if (!step.planId) continue;
    try {
      const execution = await getToolExecutionByPlanId(step.planId, organizationId);
      if (!execution) continue;

      const output = (step.output as { toolExecutionId?: string } | null) ?? {};
      const toolKeyAndResult = extractRollbackTarget(step.input as Record<string, unknown>, output);
      if (!toolKeyAndResult) continue;

      const tool = toolRegistry.getLatest(toolKeyAndResult.toolKey);
      if (!tool) continue;

      await rollbackService.rollbackSteps(ctx, execution.id, [{ stepKey: step.key, tool, result: toolKeyAndResult.result }]);
    } catch (rollbackError) {
      log.error('Workflow step rollback failed', { stepId: step.id, message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) });
    }
  }
}
```

`getRollbackService()` and `getToolRegistryService()` are the exact same singletons Phase 6's
`execution/lib/container.ts` composition root already provides — this function constructs nothing new,
it only orchestrates a **per-step call** to `RollbackService.rollbackSteps`, once per already-`SUCCEEDED`
`INVOKE_TOOL` step, in reverse order (`[...steps].reverse()`, the same "undo the last thing that
happened first" ordering Phase 6 uses within a single plan — here applied across an entire workflow
run's sequence of `INVOKE_TOOL` steps instead of within one plan's own layers). Each call passes a
single-element `CompletedStepForRollback[]` built from that step's own `ExecutionPlan`/`ToolExecution`
— every `INVOKE_TOOL` step in a workflow is its own independent Phase 6 plan/execution (see
[Approvals](./approvals.md)), so there is no cross-plan rollback machinery to build; `rollbackWorkflowSteps`
is simply the loop that calls Phase 6's existing single-plan rollback once per plan, in the right order.

`extractRollbackTarget` recovers which tool actually ran from the step's own persisted `input`/`output`
— `input.__toolKey` (the same `__toolKey` param `INVOKE_TOOL`'s handler required to build the original
`proposeAction()` request) and the `output` a Phase 6 execution produced. If either is missing (a
compound `__plan` step whose shape doesn't carry a single `__toolKey`, for instance), the function
returns `null` and that step is skipped — a workflow-level rollback covers the common single-tool
`INVOKE_TOOL` case, not every possible shape a compound plan step could take.

Each per-step rollback attempt is wrapped in its own `try`/`catch`, logged and continued past on
failure — mirroring `RollbackService.rollbackSteps`'s own internal "one step's rollback failing does not
stop the rest from being attempted" behavior, just applied one level up, across steps rather than
within one.

## The manual-intervention fallback

`failRun`'s own doc comment names this directly: "a step whose tool doesn't support rollback is
recorded as requiring manual intervention rather than silently reported as reversed." This isn't new
machinery Phase 8 built — it's `RollbackService.rollbackSteps`'s own existing `NOT_SUPPORTED` branch,
inherited unmodified:

```ts
if (step.tool.rollbackSupport === 'NOT_SUPPORTED') {
  allOk = false;
  details.push({ stepKey: step.stepKey, ok: false, error: 'Rollback not supported for this tool.' });
  continue;
}
```

An `INVOKE_TOOL` step whose underlying tool is `rollbackSupport: 'NOT_SUPPORTED'` (`RollbackSupport`
enum: `AUTOMATIC | MANUAL | NOT_SUPPORTED`, `packages/database/prisma/schema.prisma`) is never handed
to `.rollback()` — it's recorded as a failed rollback entry immediately, on the same `RollbackRecord`
row every Phase 6 execution already writes, discoverable the identical way:
`RollbackRecord.status = 'FAILED'`, `details` holding exactly which step(s) require manual cleanup and
why. Nothing about this fallback is workflow-specific — a workflow's `INVOKE_TOOL` step reuses the
*exact* mechanism a human-approved multi-step plan already has for the same situation, because under
the hood it is one.

All 5 of the reference tools registered today (`create_project`, `update_project`, `create_task`,
`create_meeting`, `archive_project` — see `apps/web/features/tools/registry.ts`) declare
`rollbackSupport: AUTOMATIC`. `MANUAL` is modeled in the type system but not yet functionally distinct
from `AUTOMATIC` in `rollbackSteps`'s own branching — only `NOT_SUPPORTED` gets special-cased — so this
path has never actually executed against a real tool in this codebase.

## `NOTIFICATION`: the one step type with `continueOnFailure`

Every step type's `failed` outcome, by default, fails the entire `WorkflowRun` — `driveWorkflowRun`'s
switch on `outcome.kind`:

```ts
case 'failed':
  await updateWorkflowRunStep(stepRow.id, { status: 'FAILED', error: outcome.error, completedAt: new Date() });
  if (!outcome.continueOnFailure) {
    await failRun(definition, run, stepRow.key, outcome.error, existingSteps);
    return;
  }
  stepRow = { ...stepRow, status: 'FAILED' };
  break;
```

`NOTIFICATION` is the one handler that ever sets `continueOnFailure: true`:

```ts
/**
 * NOTIFICATION — the one step type that is NOT run-fatal on failure by
 * default (`continueOnFailure: true`), since a Workflow's real work
 * (writes, agent turns) already succeeded by the time a notification would
 * fail — an SMTP outage shouldn't roll back or fail an otherwise-completed
 * run. Persists its own outcome as a `workflow.notification` Event
 * (`event-bus.service.ts`'s `isDispatchEligible` denylists `workflow.*`
 * from ever being a trigger match, so this can never re-enter dispatch).
 */
export const notificationHandler: WorkflowStepHandler = {
  stepType: 'NOTIFICATION',
  async execute(ctx, params) {
    // ...
    try {
      await getEmailProvider().send({ to, subject, html: body, text: body });
      await publishEvent({ /* ... status: 'sent' */ });
      return { kind: 'succeeded', output: { to, subject, status: 'sent' } };
    } catch (error) {
      // ...
      await publishEvent({ /* ... status: 'failed', error: message */ });
      return { kind: 'failed', error: message, continueOnFailure: true };
    }
  },
};
```

The reasoning is ordering, not a special case for email specifically: by the time a `NOTIFICATION` step
runs, everything a workflow was actually built to *do* — writes proposed and approved, agent turns
completed, reports generated — has already happened. An SMTP outage at the very end of a run shouldn't
roll back real, already-completed work, nor should it flip an otherwise-successful run's final status
to `FAILED` over a step whose entire job was to tell someone the real work was done. So a failed send is
recorded (as a `FAILED` `WorkflowRunStep`, and as its own `workflow.notification` Event with
`status: 'failed'` in the payload — queryable exactly like any other outcome, per this doc's "dead
letter = queryable rows" posture) but the run itself keeps going and, absent any other failure, still
reaches `COMPLETED`.

## What this does NOT do

- **No automatic retry-on-failure for any workflow step.** As stated above: `RetryPolicy` is a
  validated, persisted shape on `WorkflowStepDefinition`/`WorkflowRunStep.attempt`, but
  `driveWorkflowRun` does not currently read or act on it — a step fails on its first attempt, full
  stop. This is a real gap relative to Phase 6's `ExecutionService.runStep`, which *does* implement a
  working per-attempt retry loop for tool steps — extending the workflow driver to do the same is
  future work, not something silently already working.
- **No dead-letter queue, retry topic, or specialized failure-inspection tool.** Every failed step is an
  ordinary row in `WorkflowRunStep`, queryable with the same Prisma client as everything else — there is
  no separate infrastructure component to operate, monitor, or drain.
- **No `WorkflowRunStatus.ROLLED_BACK` actually written.** The enum defines the value and a couple of
  call sites defensively check for it as a terminal status, but `failRun` always writes `FAILED`
  regardless of whether the compensating rollback it triggers succeeds or partially fails — that finer
  distinction lives one layer down, on the `RollbackRecord`/`ToolExecution.rollbackStatus` rows each
  rolled-back `INVOKE_TOOL` step's own Phase 6 plan already produces.
- **No cross-run or cross-workflow rollback.** `rollbackWorkflowSteps` only ever concerns the
  `INVOKE_TOOL` steps of the one `WorkflowRun` that just failed — it cannot reach back into a different,
  earlier, already-`COMPLETED` run.
- **No retry of a failed rollback.** Same terminal posture as Phase 6's own `RollbackService` — a
  `RollbackRecord` that ends `FAILED` is a terminal fact; recovering from it is a manual, out-of-band
  operation, which is exactly why it's surfaced rather than swallowed.
- **No `continueOnFailure` for any step type other than `NOTIFICATION`.** Every other handler's `failed`
  outcome omits the flag entirely (defaulting to run-fatal); it is not a general per-step configuration
  option a workflow author can toggle from the builder today.
- **No functional distinction for `RollbackSupport.MANUAL`.** Modeled in the enum, not yet branched on
  differently from `AUTOMATIC` anywhere in `rollbackSteps` — and no tool in this codebase declares it,
  so the path has never run.

## Documentation index

- **[Workflow Engine](./workflow-engine.md)** — every step type's full params/output shape, including
  `NOTIFICATION`'s, and the driver loop this doc's failure branch is one arm of.
- **[Approvals](./approvals.md)** — how an `INVOKE_TOOL` step's `planId` connects back to the
  `ExecutionPlan`/`ToolExecution` this doc's rollback reuse operates on.
- **[Overview](./overview.md)** — where this fits in the full Event Bus → Workflow Engine → Execution
  Plan → Approval → Execution → Audit chain.
- **[Scheduler](./scheduler.md)** — what happens to a resumed `WAITING_TIMER` step if it then fails.
