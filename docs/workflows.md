# Workflow Automation Platform (Phase 8)

## Scope

Phase 6 gave Mr. Bond an approval-gated way to *propose* a write (docs/tool-execution.md). Phase 7
multiplied the reasoning side into a Coordinator plus five specialists (docs/agents.md). Phase 8 adds
a third way work gets triggered — not a human typing a request, but the *system itself* reacting to
something that already happened. `packages/database/prisma/schema.prisma`'s Phase 8 section states
the whole design in its own header comment:

```prisma
// ── Phase 8: Workflow Automation Platform ───────────────────────────────────
// Event-driven workflows built by organizations via a visual editor, not
// developer-registered code — unlike `Tool`/`Agent`, `WorkflowDefinition` is
// genuinely org-scoped user data (trigger/conditions/graph are all Json).
// Only the ~10 step-type handlers are developer code (code owns behavior for
// EXECUTING a step; the graph itself is data). Every write a workflow needs
// still flows through the unmodified Phase 6 chain via the same
// `proposeAction()` every other caller uses — no new write path. No
// background worker exists anywhere in this codebase (confirmed again this
// phase) — scheduling and Wait/Delay-step resumption both go through one
// externally-triggered tick endpoint, and the Event Bus is synchronous/
// in-process, wrapped so a workflow can never break the write that triggered
// it. See docs/workflows.md, docs/event-bus.md, docs/workflow-builder.md,
// docs/scheduling.md, docs/retries.md, docs/approvals.md,
// docs/workflow-templates.md.
```

Concretely, this phase is six pieces, each documented on its own: an **Event Bus** — a synchronous,
in-process `publishEvent()` a curated set of domain services call after their own write succeeds
(docs/event-bus.md); a **Workflow Builder** shape — `WorkflowStepDefinition`/`WorkflowGraphDefinition`
reusing Phase 6's `dag.ts`, and a 10-type step-handler registry (docs/workflow-builder.md); a
**re-entrant Workflow Run driver** that survives a step waiting days for a timer or a human approval
(this doc, and `workflow-run.service.ts`); a **scheduling surface** — one externally-triggered tick
endpoint that is the sole door into time-based execution (docs/scheduling.md); a **retry/rollback
posture** built entirely from pieces Phase 6 already proved out (docs/retries.md); a **Phase 8
extension to the approval gate** — an `INVOKE_TOOL`/`INVOKE_AGENT` step pauses a run exactly the way a
human-facing plan waits for approval (appended to docs/approvals.md); and **5 built-in templates** a
user instantiates into their own draft, never auto-published (docs/workflow-templates.md).

## The chain: Event Bus -> Workflow Engine -> Execution Plan -> P6 Approval -> Execution -> Audit

This is the spec's own diagram, and it is a literal description of the call graph, not a metaphor:

1. A domain write succeeds (e.g. `updateTaskService` marks a task `DONE`) and calls `publishEvent()`
   — see docs/event-bus.md. This persists an immutable `Event` row unconditionally, then attempts
   synchronous, in-process dispatch.
2. `publishEvent()`'s dispatch resolves every `ACTIVE` `WorkflowDefinition` in the organization whose
   `triggerType`/`trigger.config` and optional `WorkflowConditionNode` tree match this event, and
   calls `startWorkflowRun()` for each match — see `apps/web/features/workflows/services/event-bus.service.ts`.
3. `startWorkflowRun()`/`driveWorkflowRun()` (`workflow-run.service.ts`) walk the `WorkflowDefinition`'s
   graph one DAG layer at a time, dispatching each step to its registered handler
   (docs/workflow-builder.md). Most step types (`READ_DATA`, `SEARCH_KNOWLEDGE`, `GENERATE_REPORT`,
   `BRANCH`, `WAIT`, `DELAY`, `LOOP`, `NOTIFICATION`) run to completion inside this same synchronous
   call. Exactly one step type reaches a write: `INVOKE_TOOL` (and, indirectly, `INVOKE_AGENT` if the
   invoked agent itself proposes an action).
4. An `INVOKE_TOOL` step calls `proposeAction()` — the *exact same* function Mr. Bond's
   `<<ACTION:...>>` marker and Phase 7's agent action-marker handling already call
   (docs/planner.md, docs/agents.md). This builds an `ExecutionPlan` and an `ApprovalRequest` and
   returns; the step (and the whole `WorkflowRun`) transitions to `WAITING_APPROVAL`. There is no
   separate, workflow-specific write path — a workflow's plan is indistinguishable, once persisted,
   from one a human or an agent proposed.
5. A human approves via the unmodified `POST /api/execution/[id]/approve`
   (docs/approvals.md's Phase 6 section). `ExecutionService.executeApprovedPlan` runs exactly as it
   always has — Phase 6's file is untouched by this phase. Only after that route's own SSE stream
   finishes does a route-layer hook (`withWorkflowResumeHook`, appended in docs/approvals.md's
   Phase 8 section) call back into `resumeWorkflowRunByPlanId`, nudging the paused `WorkflowRun`
   forward.
6. Every state transition along the way — `Event`, `WorkflowRun`, `WorkflowRunStep`, `ExecutionPlan`,
   `ApprovalRequest`, `ToolExecution`, `AuditEvent` — is a persisted, queryable row. There is no
   step of this chain that exists only in memory or only in an SSE stream.

## Core principles

- **Event-driven.** A workflow never polls for state; it reacts to a curated `Event` a domain
  service published after its own write already committed (docs/event-bus.md).
- **Human-in-the-loop.** The one step type that writes, `INVOKE_TOOL`, never executes anything
  itself — it always returns `waiting_approval` and stops. There is no configuration, no "auto-approve"
  flag, no privileged workflow that skips the P6 gate. This is the same "propose, never execute"
  invariant Phase 7 upheld for agents (docs/agents.md), now upheld for workflows too.
- **Deterministic execution.** Every step handler (docs/workflow-builder.md) is plain code operating
  on already-resolved params — `GENERATE_REPORT` assembles prior outputs with no AI call and no
  invented narrative; conditions (`workflow-condition.ts`) are pure functions of the event payload
  plus, for the one `predicate` leaf type, a live DB lookup. Nothing in the run driver asks a model
  what to do next.
- **Auditable.** Every `Event`, `WorkflowRun`, and `WorkflowRunStep` is a persisted row, and every
  write a workflow produces still flows through Phase 6's `AuditEvent` trail via the unmodified
  `ExecutionService`/`ApprovalService` (docs/tool-execution.md).
- **Org-isolated.** `WorkflowDefinition`, `WorkflowRun`, `Event`, and every other Phase 8 model carry
  `organizationId`, and almost every repository function takes it as a scoping parameter. The two
  documented, deliberate exceptions — the tick endpoint's cross-organization schedule/timer sweep, and
  the webhook route's unscoped definition lookup (there is no session to scope by) — are each
  independently re-secured: the tick endpoint by a shared-secret bearer token
  (docs/scheduling.md), the webhook route by an HMAC signature plus a unique-constraint replay guard,
  both re-deriving `organizationId` from the row they find rather than trusting a caller-supplied one.
- **Extensible.** New step types are added by writing one handler file and one line in
  `apps/web/features/workflows/registry.ts` (docs/workflow-builder.md) — the same registry shape
  `ToolRegistryService`/`AgentRegistryService` already established. New trigger-eligible events are
  added by one `publishEvent()` call site (docs/event-bus.md), not a schema change.

## `WorkflowDefinition` is data; `Tool`/`Agent` are code

This is the single sentence that distinguishes Phase 8 from Phase 6/7's registries, and it is worth
stating precisely because the two shapes look superficially similar (both have an in-memory registry,
both sync metadata to a DB row):

- A `Tool` or `Agent` row is a **snapshot of code that already exists** — `ToolRegistryService`/
  `AgentRegistryService` upsert static metadata from a `*.tool.ts`/`*.agent.ts` module a developer
  wrote and shipped; the actual `validate()`/`execute()`/`think()` behavior lives in that code,
  never in the database, because functions aren't storable (docs/tool-execution.md, docs/agents.md).
  Registering a new tool or agent is a source-code change, reviewed like any other.
- A `WorkflowDefinition` row **is the workflow** — its `trigger`, `conditions`, and `graph` columns
  are `Json`, authored by an organization through a visual builder, not by a developer through a pull
  request. `WorkflowDefinitionService.create`/`updateDraft` (`apps/web/features/workflows/services/workflow-definition.service.ts`)
  are ordinary, `requireRole`-gated, org-scoped CRUD over that data — there is no equivalent
  `getWorkflowRegistry()` that imports every organization's workflows at module-load time, because
  there's no way it could: workflows aren't known until an organization creates one at runtime.
- What **is** code, and does get an in-memory registry mirroring `ToolRegistryService`'s shape
  exactly, is the fixed, ~10-entry catalog of *step-type handlers*
  (`apps/web/features/workflows/registry.ts`, docs/workflow-builder.md) — `READ_DATA`, `INVOKE_TOOL`,
  `LOOP`, and so on. A `WorkflowDefinition`'s graph names a `stepType` (data, referencing a fixed
  vocabulary); the handler that interprets what that `stepType` actually *does* is developer code,
  registered once, identically to how `Tool`/`Agent` split "metadata row" from "behavior in code" —
  just drawn one level down: the step TYPE is code, the specific WORKFLOW built from those types is
  data.

This is also why `WorkflowDefinition` is versioned and immutable-once-published rather than a bare
mutable row (`packages/database/prisma/schema.prisma`'s own comment on the model): a `Tool`/`Agent`
row never needs this because the code behind it is deployed atomically with the row that describes
it; a `WorkflowDefinition`'s "code" is itself org-authored data that can be edited at any time in the
visual builder, so publishing has to freeze a specific graph an in-flight `WorkflowRun` — possibly
waiting days on a `DELAY` step — can safely keep resuming against, the same reasoning
`ExecutionPlan.planHash` is re-verified for at execution time (docs/approvals.md).

## The re-entrant driver: why this isn't `ExecutionService` reused

`workflow-run.service.ts`'s own doc comment states the one design choice this whole phase's execution
model turns on:

```ts
/**
 * The re-entrant Workflow Run driver (Phase 8) — NOT a reuse of
 * `execution.service.ts`'s driver: that one assumes an entire DAG layer
 * resolves in one synchronous pass, which cannot survive a Wait/Delay step
 * with a downstream dependent in a later layer. This driver is repeatedly
 * invocable (from `publishEvent()`, the tick endpoint, or a manual resume
 * call) and picks up exactly where persisted `WorkflowRunStep` rows left
 * off — the same "explicitly invoked, one step at a time, state persists"
 * shape `GoalService.advance()` already established. See docs/workflows.md.
 */
```

`ExecutionService.executeApprovedPlan` is a single async generator that runs every layer of an
approved plan to completion in one call — every tool it invokes either returns or throws within that
one request. A workflow step can do neither: `DELAY`/`WAIT` return `{ kind: 'waiting_timer' }` and
expect to be resumed *later*, possibly days later; `INVOKE_TOOL`/`INVOKE_AGENT` return
`{ kind: 'waiting_approval' }` and expect to be resumed only after a human acts. There is no way to
keep an HTTP request (or even a process) alive across either gap. So `driveWorkflowRun` is written to
be safely re-called: it reloads every already-created `WorkflowRunStep` row by `key`, skips anything
already in a terminal status (`isTerminalStepStatus`, reused from `dag.ts`), and for a step still
`WAITING_APPROVAL`/`WAITING_TIMER` checks whether the wait is now over — if not, it persists
`WorkflowRun.status` accordingly and returns immediately, doing nothing further, ready to be called
again later with no lost or duplicated work. Three call sites re-enter this same function:

- `publishEvent()`'s own dispatch, for a brand-new run (`startWorkflowRun`).
- The tick endpoint, for a `WAITING_TIMER` step whose `waitUntil` has now passed
  (`resumeWorkflowRunById`, docs/scheduling.md).
- The `/api/execution/[id]/approve` route's resume hook, for a `WAITING_APPROVAL` step whose plan just
  finished executing (`resumeWorkflowRunByPlanId`, docs/approvals.md's Phase 8 section).

Each resume builds a **fresh** `WorkflowDispatchBudget` — a resumed run's remaining work is bounded
independently of whatever consumed the budget of the event that originally triggered it, since by the
time a resume happens the original synchronous dispatch call has long since returned.

## Documentation index

- **docs/event-bus.md** — the `Event`/`EventSource`/`eventType` model, `publishEvent()`'s synchronous
  dispatch, the curated call sites, the `workflow.*` denylist, and the dynamic-import cycle-breaking
  pattern every domain service uses to call it.
- **docs/workflow-builder.md** — the `WorkflowStepDefinition`/`WorkflowGraphDefinition` shape, why
  `LOOP` can't reuse the flat-DAG invariant the other 9 step types do, the step-handler registry, and
  each of the 10 step types' real params/output shape.
- **docs/scheduling.md** — the tick endpoint as the only door into time-based execution,
  `CRON_SECRET` auth, the atomic schedule claim, and `cron.ts`'s documented scope limits.
- **docs/retries.md** — the `WorkflowRunStep` retry-policy shape, the "dead letter = queryable
  `FAILED` rows" posture, rollback/compensation reuse of Phase 6's `RollbackService`, and
  `NOTIFICATION`'s unique `continueOnFailure` behavior.
- **docs/approvals.md** (Phase 8 section, appended) — how an `INVOKE_TOOL` step reaches the exact same
  `proposeAction()`/`ApprovalRequest`/`ExecutionService` chain, and the route-layer resume hook.
- **docs/workflow-templates.md** — the 5 built-in templates, and why instantiating one always creates
  a new `DRAFT`, never an auto-published workflow.
- **[docs/tool-execution.md](./tool-execution.md)** / **[docs/planner.md](./planner.md)** — the
  unmodified Phase 6 write chain every `INVOKE_TOOL` step flows through.
- **[docs/agents.md](./agents.md)** — the unmodified Phase 7 agent registry/think loop an
  `INVOKE_AGENT` step calls into.
