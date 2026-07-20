# Event Bus (Phase 8)

## Scope

`apps/web/features/workflows/services/event-bus.service.ts` — the one function, `publishEvent()`,
every workflow trigger ultimately runs through. Its own doc comment states the design in full:

```ts
/**
 * The Event Bus (Phase 8) — synchronous, in-process. `publishEvent()`
 * persists the `Event` row unconditionally, then attempts to dispatch
 * matching workflows wrapped in try/catch so a workflow failure/slowness
 * can never break the caller — mirrors `library.service.ts`'s
 * `runSmartLinkingForDocument`, already "wrapped so it can't break upload."
 * Callers never await dispatch failing; they only ever see the persisted
 * `Event`. See docs/event-bus.md.
 */
```

This doc covers the `Event`/`EventSource`/`eventType` model, `publishEvent()`'s synchronous dispatch
mechanics, the curated set of call sites that publish events today, the `workflow.*` denylist and why
it exists, and the dynamic-import pattern every one of those call sites uses to reach `publishEvent()`
without creating a circular import.

## The `Event` model

```prisma
/// The Event Bus's append-only envelope — never edited or deleted, same
/// convention as `AuditEvent`/`AgentTimelineEvent`. `eventType` is a
/// free-form, dotted string (e.g. "task.completed", "document.uploaded",
/// "workflow.notification") rather than a Prisma enum, since the event
/// taxonomy is explicitly meant to grow additively over time (spec:
/// "Extensible") — `source` is the bounded, indexed top-level category.
model Event {
  id             String      @id @default(cuid())
  organizationId String
  eventType      String
  source         EventSource
  payload        Json
  correlationId  String
  causationId    String?
  metadata       Json?
  createdAt      DateTime    @default(now())

  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  workflowRuns WorkflowRun[]

  @@index([organizationId, eventType, createdAt])
  @@index([correlationId])
  @@map("events")
}
```

`eventType` is deliberately a plain string, not an enum — the taxonomy of "things that happened" is
meant to grow by adding a new `publishEvent()` call site, never by a schema migration. `source` is the
bounded half: a fixed `EventSource` enum (`DOCUMENT`, `PROJECT`, `TASK`, `MEETING`, `CUSTOMER`,
`EMAIL`, `KNOWLEDGE_GRAPH`, `AI_COPILOT`, `AGENT`, `SYSTEM`) that a `WorkflowDefinition`'s trigger
config can filter on independently of the free-form `eventType`. `correlationId` propagates unchanged
across an entire causal chain — the event that started a `WorkflowRun`, and every nested event that
run's own steps go on to publish, all share one `correlationId`, which is what makes "everything that
happened because of this one trigger" a single indexed query. `causationId` is the narrower,
one-hop-back pointer used specifically by the dispatch budget's cycle guard (below). Rows are never
edited or deleted, the same append-only convention `AuditEvent` (docs/tool-execution.md) and
`AgentTimelineEvent` (docs/agents.md) already established.

## `publishEvent()`: persist unconditionally, dispatch best-effort

```ts
export async function publishEvent(input: PublishEventInput, budget?: WorkflowDispatchBudget): Promise<EventData> {
  const correlationId = input.correlationId ?? crypto.randomUUID();

  const event = await createEvent({
    organizationId: input.organizationId,
    eventType: input.eventType,
    source: input.source,
    payload: input.payload as Prisma.InputJsonValue,
    correlationId,
    causationId: input.causationId ?? null,
    metadata: input.metadata as Prisma.InputJsonValue | undefined,
  });

  if (!isDispatchEligible(event.eventType)) return event;

  try {
    const env = getEnv();
    await dispatchMatchingWorkflows(event, budget ?? createWorkflowDispatchBudget(env.WORKFLOW_MAX_SYNC_STEPS, env.WORKFLOW_MAX_SYNC_MS));
  } catch (error) {
    log.error('Workflow dispatch failed for event', { eventId: event.id, organizationId: event.organizationId, eventType: event.eventType, message: error instanceof Error ? error.message : String(error) });
  }

  return event;
}
```

Two phases, deliberately asymmetric in how failure is handled. The `Event` row is written first and
unconditionally — a caller's write already committed by the time it calls `publishEvent()`, so the
`Event` record of "this happened" must exist regardless of whether any workflow is listening. Dispatch
then runs wrapped in its own `try`/`catch`: a workflow that throws, times out, or hits its dispatch
budget never propagates back to the caller — the caller only ever sees the persisted `Event`, exactly
mirroring `library.service.ts`'s existing `runSmartLinkingForDocument`, already "wrapped so it can't
break upload" before this phase existed. A slow or broken workflow can never turn an ordinary
`task.updated` write into a failed HTTP request.

Dispatch itself is genuinely synchronous — `dispatchMatchingWorkflows` is `await`ed, in-process, on
the same call stack as the original write. There is no queue, no background worker, no `setTimeout`
deferral: by the time `publishEvent()` returns, every workflow it matched has either run to a terminal
step-outcome, paused at `WAITING_APPROVAL`/`WAITING_TIMER`, or failed. This is what makes the
`WorkflowDispatchBudget` (docs/workflow-builder.md's driver section, `apps/web/features/workflows/lib/workflow-dispatch-budget.ts`)
necessary at all — a step-count and wall-clock ceiling on how much synchronous work one triggering
write can be made to do, plus a cycle guard (`enterWorkflowDispatch`) that refuses to start a second
run of the *same* `WorkflowDefinition` within one dispatch chain, checked and thrown *before* a
candidate run is ever started.

## Matching: `TriggerType` bucket, then trigger config, then condition tree

`dispatchMatchingWorkflows` narrows candidates in three passes, cheapest first:

```ts
async function dispatchMatchingWorkflows(event: EventData, budget: WorkflowDispatchBudget): Promise<void> {
  const triggerType = mapEventTypeToTriggerType(event.eventType);
  if (!triggerType) return;

  const candidates = await listActiveWorkflowDefinitionsForTrigger(event.organizationId, triggerType);
  if (candidates.length === 0) return;

  const context: WorkflowConditionContext = { organizationId: event.organizationId, eventType: event.eventType, source: event.source, payload: (event.payload as Record<string, unknown>) ?? {} };

  for (const definition of candidates) {
    if (!matchesTriggerConfig(definition.trigger, event)) continue;

    const conditions = definition.conditions as WorkflowConditionNode | null;
    if (conditions && !(await evaluateWorkflowCondition(context, conditions))) continue;

    enterWorkflowDispatch(budget, definition.id);
    consumeWorkflowStep(budget);
    await startWorkflowRun(definition, event, budget);
  }
}
```

1. **`eventType` -> `TriggerType` bucket.** A deterministic, suffix-based convention maps a curated
   `eventType` string to the indexed `TriggerType` a `WorkflowDefinition` registers against —
   `.uploaded` -> `FILE_UPLOADED`, `.created` -> `ENTITY_CREATED`, `.deleted` -> `ENTITY_DELETED`,
   `.completed`/`.updated` -> `ENTITY_UPDATED`, and `insight.*` (any suffix) always -> `AI_INSIGHT`.
   `listActiveWorkflowDefinitionsForTrigger` then does one indexed DB query per event, scoped to
   `ACTIVE` definitions in this organization matching that bucket.
2. **`matchesTriggerConfig`.** A definition's own `trigger.config` (`{ source?, eventType? }`) is an
   optional finer filter within the bucket — no config matches any event of that `TriggerType`; a
   `source` and/or `eventType` narrows to exactly that.
3. **The `WorkflowConditionNode` tree**, if the definition has one — a general AND/OR/NOT/comparison/
   date/predicate tree evaluated against the event's own payload (docs/workflow-builder.md covers this
   in full; it is a materially more general mechanism than the narrow, named-predicate
   `condition-registry.ts` Phase 6 already had, and deliberately extends that file rather than
   duplicating its logic).

Dispatch to matched definitions is **sequential, not `Promise.all`** — the comment at the loop is
explicit about why: `budget` is a single shared, mutated object, and running two dispatches
concurrently would race on its own consumption (`stepsRemaining`/`deadlineAt`/
`visitedWorkflowDefinitionIds` would no longer be a reliable, monotonic record of what this one event
has already spent).

## The curated call sites

Nothing in this codebase publishes an event automatically off a raw Prisma write — `publishEvent()` is
called explicitly, once per meaningful domain transition, from exactly these locations:

| `eventType` | `source` | Call site |
|---|---|---|
| `project.created` | `PROJECT` | `apps/web/features/projects/services/project.service.ts` (`createProjectService`) |
| `project.updated` | `PROJECT` | same file (`updateProjectService`) |
| `task.updated` | `TASK` | `apps/web/features/tasks/services/task.service.ts` (`updateTaskService`) |
| `task.completed` | `TASK` | same file, additionally, only when `status === 'DONE'` |
| `meeting.created` | `MEETING` | `apps/web/features/meetings/services/meeting.service.ts` (`createMeetingService`) |
| `meeting.updated` | `MEETING` | same file (`updateMeetingService`) |
| `customer.created` | `CUSTOMER` | `apps/web/features/customers/services/customer.service.ts` (`createCustomerService`) |
| `document.uploaded` | `DOCUMENT` | `apps/web/features/documents/services/document.service.ts` |
| `document.uploaded` | `KNOWLEDGE_GRAPH` | `apps/web/features/library/services/library.service.ts` — a second, independent call site: an ordinary project document upload vs. a Knowledge Library document upload are different flows in this codebase, and each publishes its own `document.uploaded` event with its own `source` |
| `insight.created` | `AI_COPILOT` | `apps/web/features/agents/services/insight.service.ts` (Phase 7's Insight Engine, docs/insights.md) |

This is a deliberately curated, small starting set — ten call sites across seven domains — not an
attempt to instrument every mutation in the codebase. Extending it to a new domain event is a one-line
addition at the one call site the new trigger should fire from; nothing about `publishEvent()`,
`WorkflowDispatchBudget`, or the dispatch-matching logic above needs to change to support it.

## The `workflow.*` denylist

```ts
/**
 * `workflow.*` events (the 5 notification moments, all persisted as
 * `workflow.notification`) are never eligible trigger sources — otherwise
 * "notify me when a notification fires" is an ordinary-user-reachable
 * infinite loop, not an edge case. Enforced here, not left to the dispatch
 * budget alone (defense in depth: this makes the loop unreachable rather
 * than merely bounded).
 */
function isDispatchEligible(eventType: string): boolean {
  return !eventType.startsWith('workflow.');
}
```

A `WorkflowRun` itself publishes `workflow.*` events at several points — `workflow.notification` on
completion, on failure, and from the `NOTIFICATION` step handler's own send-succeeded/send-failed
outcomes; `workflow.scheduled_trigger` from the tick endpoint; `workflow.manual_trigger` from the
"Run Now" surface. If any of those were dispatch-eligible, an organization could build a workflow that
triggers on `workflow.notification` and whose own body sends a notification — a synchronous,
in-process, ordinary-user-reachable infinite loop, not a hypothetical edge case, since nothing about
building that workflow through the visual editor is invalid or requires special privilege.
`isDispatchEligible` checked at the very top of `publishEvent()`, before dispatch is even attempted,
makes that loop **unreachable** rather than merely bounded by the step/time budget — defense in depth
alongside (not instead of) `WorkflowDispatchBudget`'s cycle guard, which would otherwise be the only
thing standing between a user and a runaway synchronous loop.

## The dynamic-import cycle-breaking pattern

Every curated call site imports `publishEvent` the same unusual way — dynamically, inside the function
that needs it, not as a static top-level `import`:

```ts
/**
 * Dynamically imported at each call site below, not statically at the top
 * of this file — `publishEvent()` transitively reaches the Tool Registry
 * (via `proposeAction`, for an INVOKE_TOOL workflow step), which imports
 * every concrete `*.tool.ts` file, including `create-task.tool.ts`, which
 * imports THIS file's `createTaskService`. A static top-level import here
 * would be a real circular import; a dynamic one defers module loading past
 * both modules' initial evaluation, breaking the cycle while keeping
 * identical synchronous runtime behavior — the same pattern already used by
 * `apps/web/features/agents/lib/base-agent.ts`'s `health()`.
 */
async function getPublishEvent() {
  const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
  return publishEvent;
}
```

The cycle this breaks is real, not theoretical, and it is worth tracing end to end: `task.service.ts`
exports `updateTaskService`, which `create-task.tool.ts` imports to implement its own `execute()`
(docs/tool-execution.md). `apps/web/features/tools/registry.ts` imports every `*.tool.ts` file,
including `create-task.tool.ts`, to build the Tool Registry. `publishEvent()`'s own `INVOKE_TOOL`
handler calls `proposeAction()`, which resolves tools through that same registry. So a static
`import { publishEvent } from '.../event-bus.service'` at the top of `task.service.ts` would create
`task.service.ts -> event-bus.service.ts -> ... -> registry.ts -> create-task.tool.ts ->
task.service.ts` — a genuine circular module graph, not just a lint warning. A dynamic `import()`
inside the function body defers resolving that module until the function actually runs, by which
point both modules have already finished their own top-level evaluation, so the cycle never blocks
module loading — the runtime call sequence is otherwise identical to a static import, just resolved
one tick later.

This pattern is applied uniformly, even at call sites that don't currently sit on the Tool Registry's
import chain — `customer.service.ts` and `insight.service.ts` both use the identical dynamic-import
helper despite neither being imported by a `*.tool.ts` file today, exactly so a future tool added for
either domain doesn't silently reintroduce the cycle a static import would then create. `read-data.handler.ts`
draws the same import-graph boundary from the other direction: it calls `@bond-os/database` repository
functions directly rather than the feature service layer (`getProjectService`, etc.), since those
services are transitively reachable *from* the workflow engine already (via `proposeAction`'s Tool
Registry, for an `INVOKE_TOOL` step) — importing them into a step handler would close the same kind of
loop from the opposite side.

## What this does NOT do

- **No message broker, no queue, no at-least-once delivery.** `publishEvent()` is a plain async
  function call on the same process, same request, same call stack as the write that triggered it.
  There is no Kafka/SQS/Redis Streams equivalent anywhere in this phase, and no retry-on-delivery-
  failure semantics for the dispatch half — a workflow that throws during dispatch is logged and
  dropped for that firing, not re-queued (see docs/retries.md for what recovery a *workflow's own
  steps* do have).
- **No event replay or backfill.** `Event` rows are queryable history, not a replayable log a new
  workflow can be pointed at retroactively — activating a new `WorkflowDefinition` only ever reacts to
  events published after it goes `ACTIVE`.
- **No cross-organization event visibility.** Every `Event` carries `organizationId`, and dispatch
  matching (`listActiveWorkflowDefinitionsForTrigger`) is always scoped to the event's own
  organization — a workflow can never trigger off another organization's activity.
- **No dynamic/pluggable event taxonomy at runtime.** `eventType` strings are free-form in the schema,
  but which ones are actually ever published is fixed by the curated call sites above — there is no
  admin surface or API that lets an organization define a brand-new `eventType` a domain service will
  start emitting; extending the taxonomy is a source-code change.

## Documentation index

- **[docs/workflows.md](./workflows.md)** — the full Event Bus -> Workflow Engine -> Execution Plan ->
  Approval -> Execution -> Audit chain this file's dispatch is the first link of.
- **docs/workflow-builder.md** — the `WorkflowConditionNode` tree in full, and the step-handler
  registry each matched run actually drives through.
- **docs/scheduling.md** — the other two publishers of a triggering event (`workflow.scheduled_trigger`,
  the tick endpoint; `workflow.manual_trigger`, the "Run Now" surface), both of which start a run
  directly rather than going through `dispatchMatchingWorkflows`' event-matching at all.
