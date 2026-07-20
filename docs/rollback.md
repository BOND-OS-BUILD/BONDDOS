# Rollback (Phase 6)

## Scope

`apps/web/features/rollback/services/rollback.service.ts` — what happens after a step in an approved,
executing plan fails: every step that already reached `SUCCEEDED` gets reversed, in the opposite order
it completed in, and the attempt is recorded whether or not it actually worked. Its own doc comment
states the design in full:

```ts
/**
 * Reverses already-`SUCCEEDED` steps of a failed execution, in reverse
 * completion order — a `RollbackRecord` is written regardless of outcome,
 * and a failed rollback is surfaced, never silently swallowed: partial
 * writes with no automatic way back are a real operational alarm. See
 * docs/rollback.md.
 */
```

This doc covers `RollbackService.rollbackSteps` in full, the `RollbackRecord` model it writes, why a
failed rollback is a recorded fact rather than a swallowed exception, the "rollback always calls the
raw repository function, never the role-gated service wrapper" pattern that all five reference tools'
`rollback()` implementations follow and exactly why, and the `RollbackSupport` enum's three states —
`AUTOMATIC`, `MANUAL`, `NOT_SUPPORTED` — including which of the five reference tools uses which.

Rollback only ever runs from one call site, `ExecutionService.executeApprovedPlan`'s failure branch —
see docs/tool-execution.md for the execution engine as a whole; this doc is scoped to the rollback
mechanism itself.

## `RollbackService.rollbackSteps`

```ts
export interface CompletedStepForRollback {
  stepKey: string;
  tool: AnyToolDefinition;
  result: unknown;
}

export interface RollbackOutcome {
  succeeded: boolean;
  details: Array<{ stepKey: string; ok: boolean; error?: string }>;
}

export class RollbackService {
  constructor(private readonly audit: AuditService) {}

  async rollbackSteps(
    ctx: ToolContext,
    executionId: string,
    completedSteps: CompletedStepForRollback[],
  ): Promise<RollbackOutcome> {
    await createRollbackRecord(executionId);

    const details: RollbackOutcome['details'] = [];
    let allOk = true;

    for (const step of [...completedSteps].reverse()) {
      if (step.tool.rollbackSupport === 'NOT_SUPPORTED') {
        allOk = false;
        details.push({ stepKey: step.stepKey, ok: false, error: 'Rollback not supported for this tool.' });
        continue;
      }
      try {
        await step.tool.rollback(ctx, step.result);
        details.push({ stepKey: step.stepKey, ok: true });
      } catch (error) {
        allOk = false;
        details.push({ stepKey: step.stepKey, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    await completeRollbackRecord(executionId, {
      status: allOk ? 'SUCCEEDED' : 'FAILED',
      details: details as unknown as Prisma.InputJsonValue,
    });

    await this.audit.record(ctx.organizationId, 'rolled_back', {
      executionId,
      userId: ctx.userId,
      metadata: { succeeded: allOk, details },
    });

    return { succeeded: allOk, details };
  }
}
```

Five steps, in order: create a `PENDING` `RollbackRecord` immediately (before attempting anything, so
a rollback attempt is always on record even if the process crashes mid-way); walk `completedSteps`
reversed; for each one, either flag it unsupported or call the tool's own `rollback()` inside a
`try`/`catch` that turns a thrown error into a recorded, non-fatal `details` entry rather than an
exception that aborts the loop (`allOk` is set to `false`, but the `for` loop continues to the next
step regardless — one step's rollback failing does not stop the rest from being attempted); complete
the `RollbackRecord` with the aggregate status and the full per-step `details`; and append one
`rolled_back` audit event summarizing the whole attempt. The method's own return value
(`RollbackOutcome`) is exactly the same `{ succeeded, details }` shape that gets persisted — nothing is
computed twice.

## Reverse completion order: what "completed" means here

`rollbackSteps` only ever receives steps that reached `SUCCEEDED` — never a step that failed, was
skipped by a condition, or never ran. `ExecutionService.runStep` only produces a
`completedForRollback` entry on its success path:

```ts
const result = await tool.execute(ctx, parsedParams);
const durationMs = Date.now() - start;

await updateExecutionStep(executionId, order, {
  status: 'SUCCEEDED',
  duration: durationMs,
  result: result as Prisma.InputJsonValue,
});

return {
  event: { type: 'step_succeeded', step: eventData, durationMs },
  runtime: { status: 'SUCCEEDED', output: result },
  completedForRollback: { stepKey: key, tool, result },
};
```

The `step_skipped` and `step_failed` return paths in the same method omit `completedForRollback`
entirely — there is no `undefined` placeholder pushed for them. The caller only accumulates an entry
when one is actually present:

```ts
runtime[key] = outcome.runtime;
if (outcome.completedForRollback) completedForRollback.push(outcome.completedForRollback);
if (outcome.event.type === 'step_failed' && !failure) {
  failure = { stepKey: key, error: outcome.event.error };
}
```

So `completedForRollback` is built up strictly in the order steps finished succeeding, across the
plan's DAG layers (`for (const layer of graph.layers)` — layers run sequentially; steps *within* a
layer run concurrently via `Promise.all`, but are appended to `completedForRollback` in the layer's
declared array order, not by which concurrent step's promise happened to settle first in wall-clock
time). `rollbackSteps`' `[...completedSteps].reverse()` then walks that list backwards. For a linear
chain (the common case — e.g. `create_project` -> `create_task` -> `create_meeting`), that's exactly
"undo the last thing that happened first": a task created against a project is deleted before the
project itself is deleted, so rollback never tries to reverse a step whose own dependency has already
been torn out from under it.

The failure branch in `executeApprovedPlan` is what invokes this, and what happens to the
`ToolExecution` row afterward:

```ts
if (failure) {
  yield { type: 'rollback_started' };
  const rollbackOutcome = await this.rollbackService.rollbackSteps(ctx, execution.id, completedForRollback);
  yield rollbackOutcome.succeeded ? { type: 'rollback_succeeded' } : { type: 'rollback_failed', error: 'One or more steps could not be rolled back — see the audit trail.' };

  await updateToolExecutionStatus(execution.id, ctx.organizationId, {
    status: rollbackOutcome.succeeded ? 'ROLLED_BACK' : 'FAILED',
    completedAt: new Date(),
    error: failure.error,
    rollbackStatus: rollbackOutcome.succeeded ? 'SUCCEEDED' : 'FAILED',
  });
  await this.auditService.record(ctx.organizationId, 'execution_failed', {
    executionId: execution.id,
    userId: ctx.userId,
    metadata: { stepKey: failure.stepKey, error: failure.error },
  });

  const message = await this.persistOutcomeMessage(ctx, execution.id, plan.summary, false, failure.error);
  yield { type: 'execution_failed', executionId: execution.id, messageId: message?.id ?? null, error: failure.error };
  return;
}
```

The very first step to fail short-circuits the layer loop (`if (failure) break;`, checked at the top of
each layer iteration) — a plan never keeps executing further layers once one step has failed, it moves
straight to rollback of what already succeeded. `ToolExecution.status` lands on `ROLLED_BACK` only when
`rollbackOutcome.succeeded` is true; a *failed* rollback leaves the execution's terminal status as
`FAILED` (not `ROLLED_BACK`), with `rollbackStatus: 'FAILED'` recorded alongside it — the execution row
itself says, unambiguously, "this failed, and rollback of it also failed," rather than reusing a status
that would imply cleanup succeeded. If the user's conversation is attached, the assistant's own
outcome message reflects this directly: `persistOutcomeMessage`'s failure branch reads "I couldn't
finish this — {summary}. {error}. Any completed steps were rolled back where possible" — "where
possible" is deliberate wording, not decoration, given a rollback attempt can itself only partially
succeed.

## The `RollbackRecord` model

```prisma
/// One row per execution's rollback attempt (an execution either never needed
/// one, or has exactly one). A failed rollback is recorded, never silently
/// swallowed — partial writes with no automatic way back are a real
/// operational alarm, not a state to hide.
model RollbackRecord {
  id          String               @id @default(cuid())
  executionId String               @unique
  status      RollbackRecordStatus @default(PENDING)
  completedAt DateTime?
  details     Json?
  createdAt   DateTime             @default(now())

  execution ToolExecution @relation(fields: [executionId], references: [id], onDelete: Cascade)

  @@map("rollback_records")
}

enum RollbackRecordStatus {
  PENDING
  SUCCEEDED
  FAILED
}
```

```ts
export async function createRollbackRecord(executionId: string): Promise<RollbackRecordData> {
  return prisma.rollbackRecord.create({ data: { executionId, status: 'PENDING' } });
}

export async function completeRollbackRecord(executionId: string, data: CompleteRollbackRecordData): Promise<void> {
  await prisma.rollbackRecord.updateMany({
    where: { executionId },
    data: { ...data, completedAt: new Date() },
  });
}
```

`executionId` is `@unique` — a true 1:1 with `ToolExecution`, matching the doc comment's framing: an
execution either never needed a rollback (no row at all) or has exactly one rollback attempt (never a
history of retries; see "What's deliberately not built"). `details` is the same
`Array<{ stepKey, ok, error? }>` that `rollbackSteps` returns and logs to the audit trail, persisted
verbatim as `Json` — so a failed rollback's *per-step* detail (which steps rolled back cleanly, which
one threw, and what its error message was) is queryable from the database after the fact, not just
visible transiently in the SSE stream or the audit log's metadata blob.

`ToolExecution` also carries its own denormalized `rollbackStatus: RollbackRecordStatus` column
(defaulting `PENDING`), set by `updateToolExecutionStatus` in the failure branch above. That's a
convenience mirror, not a second source of truth: it lets a query list executions by rollback outcome
without a join to `RollbackRecord`, while the `RollbackRecord` row remains the authoritative place for
the full per-step `details`.

## Why a failed rollback is recorded and surfaced, never silently swallowed

Three independent doc comments in the codebase state the same design decision in almost the same
words — the schema comment above, the repository file's comment, and the service's own comment
(quoted at the top of this doc). The repository-level one:

```ts
/** One row per execution's rollback attempt (Phase 6) — an execution either never needed one, or has exactly one. A failed rollback is recorded, never silently swallowed. See docs/rollback.md. */
```

The reasoning is operational, not stylistic. A step failing mid-plan is an expected, handled case — the
whole point of `rollbackSteps` existing is to clean it up automatically. A rollback *itself* failing is
a materially different situation: it means the system is left holding a partial write (some steps from
the original plan reversed, one or more not) with no automatic path back to a clean state. Swallowing
that — catching the rollback error, logging it, and returning as if nothing happened — would leave an
organization's data quietly inconsistent with no record of why, discoverable only by someone noticing
the inconsistency by accident later. Instead:

- `rollbackSteps` itself never throws on a per-step rollback failure; it catches, records `ok: false`
  with the error message, keeps going, and returns `succeeded: false` for the caller to act on.
- `RollbackRecord.status` ends at `FAILED`, a terminal, queryable fact, with `details` holding exactly
  which step(s) failed and why.
- `ToolExecution.status` ends at `FAILED` (not `ROLLED_BACK`) with `rollbackStatus: 'FAILED'`, so the
  execution row itself is unambiguous about outcome.
- An `execution_failed` `AuditEvent` and a separate `rolled_back` `AuditEvent` (with
  `metadata: { succeeded: false, details }`) are both appended to the immutable audit trail (see
  docs/tool-execution.md) — a compliance-grade record survives independent of whatever the SSE stream
  or UI did with the event in the moment.
- The SSE stream itself emits a distinct `rollback_failed` event (as opposed to `rollback_succeeded`)
  with an explicit pointer — `'One or more steps could not be rolled back — see the audit trail.'` —
  rather than folding it into a generic failure event indistinguishable from an ordinary step failure.

Every one of those is a deliberate surface, not an incidental side effect: a failed rollback is
designed to be *found*, whether by a human reading the stream in real time, an operator querying
`RollbackRecord`/`ToolExecution` later, or an auditor reading `AuditEvent`.

## Rollback always calls the raw repository function, never the role-gated service wrapper

Every one of the five reference tools' `rollback()` implementations calls a raw `@bond-os/database`
repository function directly — `deleteProject`, `updateProject`, `deleteMeeting`, `deleteTask` — never
the role-gated `*Service` wrapper (`deleteProjectService`, `updateProjectService`, and so on) that
exists in `apps/web/features/*/services/*.service.ts` and that the tool's own `execute()` calls for the
forward operation. `create-project.tool.ts` states the reasoning directly, in the exact place the
pattern is sharpest:

```ts
async rollback(ctx, result) {
  // Deletes via the raw repository function, not the ADMIN-gated
  // `deleteProjectService` — this tool's own approval tier is MEMBER, and
  // rollback authorization was already established by the plan's original
  // approval, not a fresh independent delete request.
  await deleteProject(result.id, ctx.organizationId);
},
```

`create_project`'s own `permissions()` returns `ROLES.MEMBER` — a MEMBER can get a plan containing this
tool approved. But `deleteProjectService`, the gated service that already exists for the *forward* use
case of deleting a project, demands more:

```ts
export async function deleteProjectService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteProjectRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Project not found.');
}
```

If `rollback()` called `deleteProjectService` instead of the raw `deleteProject` repository function, a
rollback triggered by a MEMBER's approved plan would hit `requireRole(organizationId, ROLES.ADMIN)` and
throw `ForbiddenError` — inside the rollback path itself, at the exact moment the system is trying to
undo a write it already made. That is not a case of "the wrong person is trying to delete a project" —
the deletion here is not a fresh, independently-initiated action at all. It is the mechanical reversal
of a create that a sufficiently-privileged approval already authorized once, earlier in the same
execution. `deleteProjectService`'s `ADMIN` gate exists to answer "should *this caller* be allowed to
delete *this project*, right now, as a new request" — a question that was already answered, correctly,
by `ApprovalService.approve()`'s `requiredRole` check when the plan was approved (see
docs/approvals.md). Re-asking it during rollback, using the same service that answers it for the
unrelated forward case, would be applying a fresh authorization check to an action whose authorization
was never in question — and would fail it for a reason that has nothing to do with whether the rollback
should happen.

The same MEMBER/ADMIN mismatch reappears identically for the other two delete-based reference tools —
`create_task` (`permissions(): ROLES.MEMBER`) rolls back via raw `deleteTask`, not the ADMIN-gated
`deleteTaskService`; `create_meeting` (`permissions(): ROLES.MEMBER`) rolls back via raw
`deleteMeeting`, not the ADMIN-gated `deleteMeetingService`:

```ts
// create-task.tool.ts
async rollback(ctx, result) {
  await deleteTask(result.id, ctx.organizationId);
},

// create-meeting.tool.ts
async rollback(ctx, result) {
  await deleteMeeting(result.id, ctx.organizationId);
},
```

(`deleteTaskService`/`deleteMeetingService`, in `apps/web/features/tasks/services/task.service.ts` and
`apps/web/features/meetings/services/meeting.service.ts` respectively, both call `requireRole(...,
ROLES.ADMIN)` — the exact same shape as `deleteProjectService`.)

`update_project` and `archive_project`'s rollbacks restore previous field values rather than deleting a
row, via raw `updateProject`:

```ts
// update-project.tool.ts
async rollback(ctx, result) {
  await updateProject(result.id, ctx.organizationId, {
    description: result.before.description,
    status: result.before.status as ProjectStatus,
    priority: result.before.priority as Priority,
  });
},

// archive-project.tool.ts
async rollback(ctx, result) {
  await updateProject(result.id, ctx.organizationId, { status: result.previousStatus as ProjectStatus });
},
```

Neither of these two happens to hit a stricter gate than its own tool's approval tier —
`updateProjectService` requires only `MEMBER`, which `update_project`'s own `MEMBER` tier already
satisfies, and which `archive_project`'s `ADMIN` tier comfortably exceeds. That they *still* call the
raw `updateProject` repository function rather than `updateProjectService` shows the rule is applied
uniformly across all five tools, not selectively invoked only when a tier mismatch would otherwise
cause a rollback to fail: rollback never goes through a role-gated service wrapper, full stop, because
rollback authorization is categorically not a fresh authorization request — it doesn't matter whether
the particular gate in question would have passed or failed this time. The `create_project` /
`create_task` / `create_meeting` trio is simply where skipping the rule would visibly break something
(an ADMIN-only gate on a MEMBER-tier tool's own cleanup of its own write); `update_project` and
`archive_project` show the same design decision holding even where it isn't strictly load-bearing.

## `RollbackSupport`: `AUTOMATIC` / `MANUAL` / `NOT_SUPPORTED`

```prisma
enum RollbackSupport {
  AUTOMATIC
  MANUAL
  NOT_SUPPORTED
}
```

Every `ToolDefinition` declares a fixed `rollbackSupport` value; `rollbackSteps` only branches on one
of the three explicitly:

```ts
if (step.tool.rollbackSupport === 'NOT_SUPPORTED') {
  allOk = false;
  details.push({ stepKey: step.stepKey, ok: false, error: 'Rollback not supported for this tool.' });
  continue;
}
try {
  await step.tool.rollback(ctx, step.result);
  ...
```

A `NOT_SUPPORTED` step is never handed to `.rollback()` at all — it's recorded as a failed rollback
entry immediately (`'Rollback not supported for this tool.'`), which correctly drives the overall
`RollbackOutcome.succeeded` to `false` and surfaces the same way any other rollback failure does (see
above). Anything that isn't `NOT_SUPPORTED` — which today means every step, since all five reference
tools declare `AUTOMATIC` — falls into the `try` branch and has `.rollback()` invoked directly, with no
further distinction made between `AUTOMATIC` and `MANUAL` in this method's code today.

All five reference tools currently in the registry (`apps/web/features/tools/registry.ts`) declare
`rollbackSupport: 'AUTOMATIC'`:

| Tool | `toolKey` | `permissions()` | `rollbackSupport` | `rollback()` calls |
|---|---|---|---|---|
| Create Project | `create_project` | `MEMBER` | `AUTOMATIC` | `deleteProject` (raw) |
| Update Project | `update_project` | `MEMBER` | `AUTOMATIC` | `updateProject` (raw) |
| Create Task | `create_task` | `MEMBER` | `AUTOMATIC` | `deleteTask` (raw) |
| Create Meeting | `create_meeting` | `MEMBER` | `AUTOMATIC` | `deleteMeeting` (raw) |
| Archive Project | `archive_project` | `ADMIN` | `AUTOMATIC` | `updateProject` (raw) |

`ExecutionPlan.rollbackStrategy` aggregates this per-tool value to a single plan-level worst case,
computed by `PlannerService` at build time:

```ts
private computeRollbackStrategy(tools: AnyToolDefinition[]): RollbackSupport {
  if (tools.some((tool) => tool.rollbackSupport === 'NOT_SUPPORTED')) return 'NOT_SUPPORTED';
  if (tools.some((tool) => tool.rollbackSupport === 'MANUAL')) return 'MANUAL';
  return 'AUTOMATIC';
}
```

`NOT_SUPPORTED` beats `MANUAL` beats `AUTOMATIC` — a single `NOT_SUPPORTED` step anywhere in a plan
makes the whole plan's `rollbackStrategy` `NOT_SUPPORTED`, shown on the approval card so an approver
knows up front that a failure partway through this specific plan may leave some writes unrecoverable.
Because every current reference tool is `AUTOMATIC`, every `ExecutionPlan` built today ends up with
`rollbackStrategy: 'AUTOMATIC'` — but the aggregation logic itself already handles all three states
correctly; it does not need to change when a `MANUAL` or `NOT_SUPPORTED` tool is eventually added.

`NOT_SUPPORTED` is a real, first-class, structurally-supported state — the schema models it, the
`Tool.rollbackSupport` column defaults to it (`@default(NOT_SUPPORTED)`, the conservative default for
any newly-registered tool that hasn't explicitly opted into rollback), `rollbackSteps` has dedicated
branching for it, and `computeRollbackStrategy` propagates it correctly to the plan level. It is simply
not exercised by any of the five current reference tools, all of which happen to model operations
(create/update a row this org owns) that are cleanly reversible. A future tool wrapping an
irreversible or external side effect — sending an email, calling a third-party API with no undo — would
set `NOT_SUPPORTED` and every piece of this machinery already knows what to do with it: skip
`.rollback()`, record the failure, surface it, and mark the containing plan's `rollbackStrategy`
accordingly at approval time.

## What's deliberately not built

- **`MANUAL` is modeled but not yet distinguished in code from `AUTOMATIC`.** The `RollbackSupport` enum
  and `computeRollbackStrategy`'s aggregation both treat `MANUAL` as its own state, but
  `rollbackSteps`' own branching only special-cases `NOT_SUPPORTED` — a `MANUAL`-tagged tool's
  `rollback()` would currently be invoked exactly the same automatic way an `AUTOMATIC` tool's is. No
  reference tool sets `MANUAL`, so this path has never actually run; a future tool that needs true
  human-in-the-loop rollback (rather than "safe to auto-reverse") would need `rollbackSteps` extended
  to treat it differently, e.g. by recording a pending manual-action entry instead of calling
  `.rollback()` at all.
- **No retry of a failed rollback.** `rollbackSteps` runs exactly once per execution
  (`RollbackRecord.executionId` is `@unique`); there is no endpoint or service method that re-attempts
  a `FAILED` `RollbackRecord`. Recovering from one is an out-of-band, manual operation — which is
  exactly why a failed rollback is recorded and surfaced rather than swallowed.
- **No compensating-transaction framework.** Each tool hand-writes its own `rollback()` against its own
  domain logic; there is no generic mechanism that captures an automatic "undo" from `execute()`'s
  database diff, and no shared before/after-state machinery beyond what a tool's own `execute()` result
  happens to carry (e.g. `update_project`'s `Output.before`).
- **No rollback of a rollback.** Once a `RollbackRecord` reaches `FAILED`, that is a terminal fact for
  the execution attempt — there is no further automatic action, no cascading second-order recovery.
- **No cross-execution rollback.** `rollbackSteps` only ever concerns the steps of the one execution
  that just failed; it has no way to reach back into a different, earlier, already-`SUCCEEDED`
  execution.
- **No partial retry of the failed plan itself.** A failed-then-rolled-back execution is terminal; there
  is no "resume from the step that failed" — a user has to build and approve a new plan from scratch.
