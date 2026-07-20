# Workflow Builder & Step Handlers (Phase 8)

## Scope

`apps/web/features/workflows/lib/workflow-graph.ts` (the graph shape a `WorkflowDefinition.graph`
column stores), `apps/web/features/workflows/lib/step-handler.ts` (the Step Handler SDK every step
type implements), and `apps/web/features/workflows/registry.ts` (the registry that wires the two
together) — plus the 10 concrete handlers under `apps/web/features/workflows/step-handlers/`. This doc
covers the graph shape and why it reuses Phase 6's `dag.ts` rather than forking it, why `LOOP` is the
one step type that genuinely cannot reuse that same flat-DAG invariant and how its scope is bounded
instead, the step-handler registry pattern, and each of the 10 step types' real params/output shape as
implemented — not as designed on paper.

## The graph shape: `WorkflowStepDefinition` extends `dag.ts`'s `GraphStep`

```ts
/**
 * A `WorkflowDefinition.graph`'s shape (Phase 8) — a flat DAG via
 * `dependsOn`, reusing `dag.ts`'s `computeLayers`/`validatePlanSteps`
 * (generalized to accept this shape, see the `GraphStep` note in dag.ts)
 * instead of a Phase-8-specific graph engine. `stepType` stands in for
 * `ExecutionStepDefinition.toolKey`/`version` — a workflow step names a
 * STEP TYPE (one of the 10 developer-defined handlers), never a tool
 * directly; `INVOKE_TOOL` steps carry the actual `toolKey` inside `params`.
 * See docs/workflow-builder.md.
 */
export interface WorkflowStepDefinition extends GraphStep {
  stepType: WorkflowStepType;
  /** May contain `$steps.<key>.output.<path>` references, resolved via `dag.ts`'s `resolveStepParams` — identical syntax to Phase 6 Plan Graph params. */
  params: Record<string, unknown>;
  condition?: StepCondition;
  retry?: RetryPolicy;
}

export interface WorkflowGraphDefinition {
  steps: WorkflowStepDefinition[];
}
```

Nothing about `computeLayers`/`validatePlanSteps` (docs/planner.md) actually needs to know about
`toolKey`/`version` — both functions only ever touch `key` and `dependsOn`. `dag.ts` makes that
minimal dependency explicit as its own exported type, generalized so Phase 8 can reuse the identical
algorithm rather than fork it:

```ts
/** The minimal shape `validatePlanSteps`/`computeLayers` actually need — neither touches `toolKey`/`params`/anything else, so both are generic over this rather than hardcoded to `ExecutionStepDefinition`. This is what lets Phase 8's `WorkflowStepDefinition` (a different shape — `stepType` instead of `toolKey`/`version`) reuse the same graph-layering algorithm instead of forking it; existing Phase 6 callers are unaffected since `ExecutionStepDefinition` already satisfies this constraint and `T` is inferred automatically. */
export interface GraphStep {
  key: string;
  dependsOn: string[];
}

export function validatePlanSteps<T extends GraphStep>(steps: T[]): void { ... }
export function computeLayers<T extends GraphStep>(steps: T[]): PlanGraph { ... }
```

`workflow-run.service.ts`'s `driveWorkflowRun` calls `validatePlanSteps(graph.steps)` and
`computeLayers(graph.steps)` directly on `WorkflowStepDefinition[]` — the exact same cycle-detection,
duplicate-key-detection, and Kahn's-algorithm layering Phase 6 plans use, with `T` inferred as
`WorkflowStepDefinition` automatically. Sequential dependency, implicit same-layer parallelism, and
per-step `RetryPolicy` all fall out of this reuse for free, exactly as they do for a Phase 6
`ExecutionPlan` (docs/planner.md's "flat DAG, not a nested tree grammar" section applies verbatim
here — this doc does not repeat that reasoning). Param resolution is the same reuse too:
`resolveStepParams`/`resolveParamValue` (`dag.ts`) resolve a step's `$steps.<key>.output.<path>`
references — including the ` ?? ` fallback-chain syntax — against a `Record<string,
StepRuntimeInfo>` the driver builds from `WorkflowRunStep` rows, identical syntax and identical
resolve-once-per-step-immediately-before-it-runs timing to Phase 6's Plan Graph params.

A workflow step's own `condition` (`StepCondition`, a named predicate from
`apps/web/features/planner/lib/condition-registry.ts`) is a distinct mechanism from a workflow's
*trigger-level* `WorkflowConditionNode` tree (`workflow-condition.ts`) — the driver's own comment
draws this line explicitly: "Phase 6-style named predicate, distinct from the workflow-level trigger
`WorkflowConditionNode` tree." The former gates whether one step inside an already-running graph
executes (the IF-EXISTS/ELSE pattern, reused verbatim from Phase 6); the latter gates whether an
*event* is even eligible to start a run in the first place (docs/event-bus.md). `workflow-condition.ts`
extends `condition-registry.ts` for its one leaf type that needs a live DB lookup (`predicate`) rather
than duplicating the AND/OR/NOT tree logic — see the `user_has_role` predicate added to
`condition-registry.ts` below.

## Why `LOOP` can't reuse the flat-DAG invariant

Every other step type is a single node in the outer graph — it runs once, and its readiness/placement
is entirely governed by `computeLayers`. `LOOP` is different: its body is itself a sub-step that must
run once *per item* in a runtime-determined array, and the whole iteration has to complete inside one
`WorkflowRunStep`'s single `execute()` call, not as N additional nodes in the outer DAG. The handler's
own comment states why a more general design — letting a loop body be resumable mid-iteration — was
deliberately not built:

```ts
/**
 * Step types a LOOP body may use — deliberately excludes INVOKE_TOOL/
 * INVOKE_AGENT/WAIT/DELAY/LOOP. A loop iteration must complete
 * synchronously within one `WorkflowRunStep`; allowing a sub-step that
 * itself needs approval or a timer would require making LOOP resumable
 * mid-iteration, tracking which of N items already ran — genuinely new
 * engine complexity out of scope for this release. Documented here, not
 * silently unsupported: an excluded sub-step type fails validation
 * immediately, not at iteration 30 of 50.
 */
const ALLOWED_LOOP_BODY_TYPES = new Set<WorkflowStepType>(['READ_DATA', 'SEARCH_KNOWLEDGE', 'GENERATE_REPORT', 'NOTIFICATION', 'BRANCH']);
```

If a loop body could contain `INVOKE_TOOL`, one iteration pausing at `WAITING_APPROVAL` would require
the outer `LOOP` step itself to become resumable — persisting which of N items had already run, which
one is mid-flight, and re-entering the loop body at the right index after a human approves days later.
That is real, new state machinery the driver's current re-entrancy model (one `WorkflowRunStep` = one
terminal outcome, or a wait) doesn't provide. Rather than build it, `LOOP`'s scope is bounded to five
step types that are all guaranteed to resolve synchronously (`READ_DATA`, `SEARCH_KNOWLEDGE`,
`GENERATE_REPORT`, `NOTIFICATION`, `BRANCH`) and enforced at validation time — an excluded sub-step
type throws `ValidationError` the moment the loop step runs, not partway through a long iteration:

```ts
if (!ALLOWED_LOOP_BODY_TYPES.has(subStep.stepType)) {
  throw new ValidationError(`LOOP: step type "${subStep.stepType}" cannot run inside a loop body (allowed: ${Array.from(ALLOWED_LOOP_BODY_TYPES).join(', ')}).`);
}
```

`LOOP` also bounds iteration count (`MAX_ITERATIONS = 50`, or a caller-supplied `maxIterations`
clamped to that ceiling) and consumes one unit of the shared `WorkflowDispatchBudget` per iteration
(`consumeWorkflowStep(budget)`), so a loop over a large `items` array is still subject to the same
step/time ceiling every other synchronous dispatch chain is (docs/event-bus.md). And because
`loop.handler.ts` is itself one of the files the step-handler registry imports, it cannot statically
import `getWorkflowStepHandlerRegistry` — doing so would be a direct self-referential cycle
(`registry.ts` imports `loop.handler.ts`, which would import `registry.ts`). It resolves its sub-step's
handler via the same dynamic-`import()` cycle-breaking pattern docs/event-bus.md documents for domain
services:

```ts
const { getWorkflowStepHandlerRegistry } = await import('../registry');
const registry = getWorkflowStepHandlerRegistry();
const subHandler = registry.get(subStep.stepType);
```

## The Step Handler SDK and registry

```ts
/**
 * The Step Handler SDK (Phase 8) — mirrors `ToolDefinition`'s "code owns
 * behavior" shape exactly, but for the ~10 fixed step TYPES rather than an
 * open-ended set of tools: a `WorkflowDefinition`'s graph is user data, the
 * handler that interprets each `stepType` is developer code, registered
 * through `WorkflowStepHandlerRegistry` the same way `ToolRegistryService`/
 * `AgentRegistryService` register their own fixed/growing catalogs. See
 * docs/workflow-builder.md.
 */
export interface WorkflowStepHandler {
  stepType: WorkflowStepType;
  execute(ctx: WorkflowStepHandlerContext, params: Record<string, unknown>, budget: WorkflowDispatchBudget): Promise<WorkflowStepOutcome>;
}
```

`WorkflowStepHandlerContext` carries `organizationId`, `ownerId` (nullable — the workflow's owner, the
accountable party for any write a run proposes; a workflow with a write step cannot be published
without one), `runId`, `workflowDefinitionId`, and the triggering `Event`. `WorkflowStepOutcome` is a
5-case discriminated union every handler returns: `succeeded` (with output), `skipped`,
`waiting_approval` (with a `planId`), `waiting_timer` (with a `waitUntil` Date), or `failed` (with an
error and an optional `continueOnFailure` flag — see docs/retries.md).

`apps/web/features/workflows/registry.ts` is the single file that imports every concrete handler,
mirroring `apps/web/features/tools/registry.ts`/`apps/web/features/agents/registry.ts` exactly:

```ts
/**
 * The ONLY file in this codebase that imports every concrete step-handler
 * implementation — mirrors `apps/web/features/tools/registry.ts`/
 * `apps/web/features/agents/registry.ts` exactly. `event-bus.service.ts`
 * and `workflow-run.service.ts` only ever call `registry.get(stepType)`,
 * never import a concrete `*.handler.ts` file directly. See
 * docs/workflow-builder.md.
 */
const ALL_HANDLERS: WorkflowStepHandler[] = [
  readDataHandler, searchKnowledgeHandler, invokeAgentHandler, invokeToolHandler,
  waitHandler, branchHandler, delayHandler, loopHandler, notificationHandler, generateReportHandler,
];
```

`WorkflowDefinitionService.publish` (`apps/web/features/workflows/services/workflow-definition.service.ts`)
also checks every step's `stepType` resolves against this same registry (`registry.get(step.stepType)`)
before a `DRAFT` can ever become `ACTIVE` — an unknown step type is caught at publish time, not
discovered mid-execution.

## The 10 step types

### `READ_DATA`

Reads one record by entity type and id, straight from `@bond-os/database` repository functions —
deliberately not the feature service layer (`getProjectService`, etc.), since those services are
transitively reachable *from* the workflow engine already via `proposeAction`'s Tool Registry for an
`INVOKE_TOOL` step, and importing them here would close a real circular import (docs/event-bus.md's
dynamic-import section covers the same boundary from the domain-service side).

- **Params:** `{ entityType: 'project' | 'task' | 'meeting' | 'customer' | 'document' | 'knowledgeDocument', id: string }`
- **Output (`succeeded`):** `{ record: <the entity> }`
- Throws `ValidationError` for an unknown `entityType`, `NotFoundError` if the record doesn't resolve
  in `ctx.organizationId`.

### `SEARCH_KNOWLEDGE`

Calls the same hybrid-search primitive (`retrieve()`, `apps/web/features/retrieval/services/retrieval.service.ts`)
Bond's own `search` read-tool and every retrieval-driven surface already use — "never bypasses
retrieval, matching the RAG pipeline's own 'no shortcuts' rule."

- **Params:** `{ query: string, limit?: number }` (`limit` defaults to `10`)
- **Output:** `{ results: Array<{ ref, title, snippet }> }`

### `INVOKE_AGENT`

Resolves an agent via the same `AgentRegistryService` Phase 7's Coordinator/specialists use, builds a
real `AgentContext` for the workflow's owner, and calls `.think()`. If the invoked agent itself
proposes a write mid-turn (`action_proposed`), this step transitions to `waiting_approval` — the same
terminal state an `INVOKE_TOOL` step reaches, with no special-casing needed since it's the same P6
chain either way.

- **Params:** `{ agentKey: string, question: string }`
- **Output (`succeeded`):** `{ agentKey, answer: string }`
- **Or:** `{ kind: 'waiting_approval', planId }` if the agent's turn produced an action.
- Requires `ctx.ownerId`; throws `ForbiddenError` if that owner is no longer a member of the org.

### `INVOKE_TOOL`

The one step type that ever reaches a write. Never executes a tool itself — always calls
`proposeAction()` (the same function Mr. Bond's `<<ACTION:...>>` marker and Phase 7's agent-proposed
actions call) and returns `waiting_approval`.

- **Params (single-tool):** `{ __toolKey: string, __version?: string, ...toolParams }`
- **Params (compound plan):** `{ __plan: { summary: string, steps: [...] } }` — mirrors
  `PlanRequestInput`'s own discriminated `single`/`compound` shape.
- **Output:** always `{ kind: 'waiting_approval', planId }` — see docs/approvals.md's Phase 8 section.
- Requires `ctx.ownerId`.

### `WAIT`

Pauses until a specific point in time.

- **Params:** `{ until: string }` — an ISO timestamp.
- **Output:** `{ kind: 'waiting_timer', waitUntil }` if `until` is still in the future; otherwise
  resolves immediately with `{ kind: 'succeeded', output: { waitedUntil: until } }`.

### `DELAY`

Pauses a fixed duration from when the step first ran (as opposed to `WAIT`'s fixed point in time).

- **Params:** `{ durationMs: number }` — must be positive and at most 30 days
  (`MAX_DELAY_MS = 1000 * 60 * 60 * 24 * 30`, "a sane upper bound, not an arbitrary one — nothing in
  this codebase runs a workflow run open-ended").
- **Output:** `{ kind: 'waiting_timer', waitUntil: new Date(Date.now() + durationMs) }`.
- `execute()` runs exactly once, to compute `waitUntil`; the driver resumes a `WAITING_TIMER` step
  directly once the deadline passes, without calling this handler again — re-calling it on resume
  would recompute a fresh duration-from-now and the wait would never actually elapse.

### `BRANCH`

Not a distinct runtime behavior — a fork point in the visual builder only. The actual branching is two
downstream steps at the same DAG layer with complementary `condition`s, the exact IF-EXISTS/ELSE
pattern Phase 6 established (docs/planner.md); `computeLayers` doesn't need to know branching exists,
it just sees two steps with identical `dependsOn`, and the driver's generic per-step `condition` check
decides which one runs vs. lands `SKIPPED`. `BRANCH` exists purely so the type itself is a valid,
registerable `stepType` for the graph.

- **Params:** none required.
- **Output:** always `{ kind: 'succeeded', output: {} }`.

### `LOOP`

Bounded iteration over `params.items`, running `params.subStep` once per item, substituting
`$loop.item`/`$loop.index` placeholders into the sub-step's own params. See "Why `LOOP` can't reuse
the flat-DAG invariant" above for its scope limits.

- **Params:** `{ items: unknown[], subStep: { stepType, params }, maxIterations?: number }`
- **Output:** `{ iterations: number, results: Array<{ index, output }> }`
- A `failed` sub-step outcome fails the whole loop; a `skipped` sub-step outcome is simply omitted from
  `results` and iteration continues.

### `NOTIFICATION`

Sends an email via `getEmailProvider()` and publishes its own outcome back onto the Event Bus as
`workflow.notification` — see docs/retries.md for why this is the one step type that doesn't fail its
run by default.

- **Params:** `{ to: string, subject: string, body: string }`
- **Output (send succeeded):** `{ to, subject, status: 'sent' }`
- **Output (send failed):** `{ kind: 'failed', error, continueOnFailure: true }`

### `GENERATE_REPORT`

Deterministically assembles prior step outputs into a structured report — no AI call, no invented
narrative, matching this phase's own "Deterministic execution" core principle (docs/workflows.md).
`sections[].content` values are plain params, already resolved by the driver via `dag.ts`'s
`resolveStepParams` before this handler ever sees them, exactly like every other step's params.

- **Params:** `{ title: string, sections: Array<{ label: string, content: unknown }> }`
- **Output:** `{ title, generatedAt: <ISO timestamp>, sections: [...] }`

## The `user_has_role` predicate

`condition-registry.ts` gained one new entry this phase, extending the same registry Phase 6's
`project_exists_by_title` already lives in, for the one leaf type of `WorkflowConditionNode`
(`predicate`) that genuinely needs a live DB lookup rather than a pure comparison against the event
payload:

```ts
/**
 * Phase 8: Workflow "User filters" — a named predicate (not a plain
 * payload comparison, since it needs a live DB lookup) used by
 * `WorkflowConditionNode`'s `predicate` leaf type, extending this same
 * registry rather than duplicating the AND/OR/NOT tree logic elsewhere —
 * see `apps/web/features/workflows/lib/workflow-condition.ts`.
 */
async user_has_role(organizationId, args) {
  const userId = typeof args.userId === 'string' ? args.userId : '';
  const role = typeof args.role === 'string' ? args.role : '';
  if (!userId || !role) return false;
  const membership = await prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
  if (!membership) return false;
  return ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY[role as keyof typeof ROLE_HIERARCHY];
},
```

Checked the same way `project_exists_by_title` is — `isKnownConditionPredicate` at plan/workflow-build
time, `evaluateCondition` fresh at evaluation time, never cached. `workflow-condition.ts`'s own
`evaluateWorkflowCondition` routes its `predicate` leaf node straight into this same function:

```ts
case 'predicate': {
  if (!isKnownConditionPredicate(node.predicate)) {
    throw new Error(`Unknown workflow condition predicate: "${node.predicate}".`);
  }
  return evaluateCondition(context.organizationId, { predicate: node.predicate, args: node.args, negate: node.negate ?? false });
}
```

`role` uses the same `ROLE_HIERARCHY[...] >= ROLE_HIERARCHY[...]` "at least this role" comparison
`roleSatisfies` uses for approval-gate checks (docs/approvals.md), not exact equality — a workflow
condition of `{ predicate: 'user_has_role', args: { userId, role: 'MEMBER' } }` matches an `ADMIN` or
`OWNER` too.

## What this does NOT do

- **No visual-builder UI documented here.** This doc covers the `WorkflowGraphDefinition` JSON shape
  and the handlers that interpret it — how an organization's visual editor produces that JSON is
  outside this doc's scope.
- **No custom/plugin step types.** `ALL_HANDLERS` is a literal array in `registry.ts`, populated at
  module load, mirroring the Tool/Agent registries' own "no dynamic/plugin loading" posture
  (docs/tool-execution.md) — adding an 11th step type is a source-code change, not something reachable
  from the builder UI or an API call.
- **No resumable `LOOP` body.** Covered above in full — a loop iteration must complete synchronously
  within one `WorkflowRunStep`; `INVOKE_TOOL`/`INVOKE_AGENT`/`WAIT`/`DELAY`/`LOOP` are all excluded
  from a loop body, by validation, not convention.
- **No nested/recursive workflow graphs.** Every `WorkflowGraphDefinition` is a flat
  `WorkflowStepDefinition[]`, exactly like a Phase 6 Plan Graph — there is no sub-workflow, no step
  whose params embed another graph (`LOOP`'s single `subStep` is the one place a step's params embed
  another step definition, and it's bounded to the 5 allowed types above, not a general nesting
  mechanism).

## Documentation index

- **[docs/workflows.md](./workflows.md)** — the full chain a matched `WorkflowDefinition` runs
  through, and why `WorkflowDefinition` is data while these step-type handlers are code.
- **[docs/event-bus.md](./event-bus.md)** — how a `WorkflowRun` gets started in the first place.
- **docs/retries.md** — per-step retry policy, rollback of `INVOKE_TOOL` steps, and `NOTIFICATION`'s
  `continueOnFailure`.
- **docs/scheduling.md** — how a `WAITING_TIMER` step (from `WAIT`/`DELAY`) actually gets resumed.
- **[docs/planner.md](./planner.md)** — `dag.ts`'s full flat-DAG/IF-EXISTS-ELSE/param-resolution
  design, reused verbatim by this phase.
