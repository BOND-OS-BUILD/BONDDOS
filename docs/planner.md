# Plan Graph & Planner (Phase 6)

## Scope

Phase 6's spec asks for an "Execution Planner" that "converts natural language intent into
executable steps... Planner only produces plans. No execution occurs" — and separately requires the
Plan Graph itself to "support Sequential/Parallel/Conditional/Retry." This doc covers the five files
that jointly satisfy that: the graph representation and its reference-resolution logic
(`apps/web/features/planner/lib/dag.ts`), the condition registry
(`apps/web/features/planner/lib/condition-registry.ts`), the shape an already-parsed request takes
(`apps/web/features/planner/lib/plan-request.ts`), how that request gets parsed out of the model's
own text (`apps/web/features/planner/services/intent-detection.service.ts`), and the service that
turns any of the above into a validated, hashed, persisted `ExecutionPlan`
(`apps/web/features/planner/services/planner.service.ts`). `PlannerService`'s own doc comment states
the whole chain in three sentences:

```ts
/**
 * The Execution Planner (spec: "converts natural language intent into
 * executable steps... Planner only produces plans. No execution occurs.").
 * The LLM proposes WHICH tools + params via the `<<ACTION:...>>` marker
 * convention (see `intent-detection.service.ts`); this service is the
 * deterministic layer that validates, structures, and hashes what it
 * proposed — the approval card's content comes from here, never from raw
 * LLM text, mirroring Phase 5's citation-validation posture. See
 * docs/planner.md.
 */
```

That last clause — "mirroring Phase 5's citation-validation posture" — is the throughline for this
whole doc: exactly like `validateCitations` never trusts a `[ref]` marker the model wrote without
checking it against what was actually retrieved (docs/citations.md), nothing here ever lets a
model's raw `<<ACTION:...>>` JSON reach a tool's `execute()` unchecked. Every step of what the model
proposes gets re-validated by Zod schemas, business rules, DAG structural checks, and a content hash
before an `ExecutionPlan` row even exists, let alone before anyone can approve it.

## The Plan Graph: a flat DAG, not a nested tree grammar

`dag.ts`'s own header comment states the representation choice directly:

```ts
/**
 * The Plan Graph (Phase 6, spec's "Plan Graph must support Sequential/
 * Parallel/Conditional/Retry"). A flat list of `ExecutionStepDefinition`s
 * forming a DAG via `dependsOn`, not a nested tree grammar — see
 * docs/planner.md for why. This file is generic graph/reference-resolution
 * logic only: no Project/Task/Customer knowledge anywhere in it.
 */
```

A step is:

```ts
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
```

There is no `{ type: 'sequence', children: [...] }` / `{ type: 'parallel', children: [...] }` /
`{ type: 'if', then: ..., else: ... }` recursive grammar anywhere in this file — a plan is just
`ExecutionStepDefinition[]`, and every relationship between steps is expressed through one field,
`dependsOn`. Three things about the four spec requirements fall directly out of that flat shape
rather than needing dedicated node types:

- **Sequential** is just `stepB.dependsOn = ['stepA']`.
- **Parallel** is implicit, not a wrapper node: any two steps that don't depend on each other land in
  the same layer automatically (see `computeLayers` below) — nothing has to *declare* "run these two
  in parallel," it falls out of the graph's shape.
- **Conditional** is two steps at the same layer (identical `dependsOn`) with complementary
  `condition`s — covered in full in "The IF-EXISTS/ELSE pattern" below. `computeLayers`'s own comment
  is explicit that the graph algorithm doesn't need to know this is happening: "Two steps at the same
  layer with complementary `condition`s (the IF-EXISTS/ELSE pattern) is how conditional branching is
  represented; this function doesn't need to know that, it just sees two steps with identical
  `dependsOn`." A nested tree grammar would need a dedicated `if/else` node type that the graph
  algorithm *does* have to know about, and — more importantly for the compound-plan case below — a
  downstream step that depends on the *output* of whichever branch actually ran wouldn't have a
  natural place to attach in a tree (it isn't "inside" either branch; it depends on both).
- **Retry** is a plain per-step field (`RetryPolicy { maxAttempts, backoffMs }`), not a graph
  structure at all.

A flat list is also simply the easier shape for the two producers of a plan to emit correctly: the
deterministic `create_project`/`update_project` template (`PlannerService.expandRequest`, below)
builds one directly as a plain array literal, and an LLM proposing a compound `<<ACTION:plan>>`
(intent-detection, below) emits one JSON array of step objects with `dependsOn` string arrays — both
considerably simpler to produce, and to validate afterward, than a recursive tree grammar would be.

`validatePlanSteps` catches structural problems before anything else runs — duplicate step keys, or
a `dependsOn` pointing at a step that isn't in this plan:

```ts
export function validatePlanSteps(steps: ExecutionStepDefinition[]): void {
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
```

`computeLayers` then does the actual DAG-to-execution-order work — Kahn's algorithm, one layer at a
time, each layer being every not-yet-placed step whose entire `dependsOn` set has already been
placed in an earlier layer:

```ts
export function computeLayers(steps: ExecutionStepDefinition[]): PlanGraph {
  validatePlanSteps(steps);

  const byKey = new Map(steps.map((step) => [step.key, step]));
  const resolved = new Set<string>();
  let remaining = new Set(byKey.keys());
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
```

If a pass through `remaining` produces an empty layer, no step could be placed — a cycle — and it
throws `PlanGraphError` rather than looping forever. The result, `PlanGraph { layers: string[][] }`,
is exactly what `ExecutionService.executeApprovedPlan` walks: layers run in sequence, and every step
key within one layer runs concurrently via `Promise.all` (docs/tool-execution.md's `ExecutionService`
section).

## Terminal state satisfies a dependency

A downstream step's readiness to run isn't gated on its dependencies having *succeeded* — it's
gated on them having *finished*, however they finished:

```ts
/** Statuses a step can be in when it's done running, one way or another — the set that satisfies a downstream `dependsOn`. A downstream step waits for its dependencies to reach ANY of these, not specifically `SUCCEEDED`; otherwise a step depending on two complementary conditional branches (one of which is always `SKIPPED`) would deadlock forever. */
const TERMINAL_STEP_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'SKIPPED', 'ROLLED_BACK']);

export function isTerminalStepStatus(status: string): boolean {
  return TERMINAL_STEP_STATUSES.has(status);
}
```

The scenario the comment names is concrete, not hypothetical: take the IF-EXISTS/ELSE pair below
(`update_existing` / `create_new`), and imagine a third, downstream step that needs whichever branch
actually ran — `dependsOn: ['update_existing', 'create_new']`, with a param like
`$steps.update_existing.output.id ?? $steps.create_new.output.id`. By `condition`'s construction,
*exactly one* of `update_existing`/`create_new` ever runs its tool body to completion (`SUCCEEDED` or
`FAILED`); the other is skipped by its condition and lands in `SKIPPED`. If a downstream dependency
were only satisfied by `SUCCEEDED`, the downstream step would wait forever on whichever branch didn't
run — a permanent deadlock, not a transient error. Counting `SKIPPED` (and `FAILED`, and
`ROLLED_BACK`) as equally dependency-satisfying is what makes "depends on both branches of a
conditional" representable at all.

This is upheld architecturally, not by a runtime check that calls `isTerminalStepStatus` directly:
`ExecutionService.executeApprovedPlan` runs `graph.layers` strictly in order, and every step in a
layer — whichever of `runStep`'s branches it takes (condition-skip, success, or exhausted-retries
failure) — always *returns* rather than hanging, so `Promise.all(layer.map(...))` always settles
before the next layer starts, regardless of individual outcomes. `TERMINAL_STEP_STATUSES` is the
codified statement of the invariant that architecture relies on, which is also exactly what license
the `$steps.*.output.*` fallback chain below needs to exist: a reference into a `SKIPPED` step's
(nonexistent) `output` has to be a normal, anticipated "not found, try the next alternative" case,
not a crash.

## Param resolution: the `$steps.*.output.*` fallback chain

A step's `params` can reference an upstream step's result instead of a literal value. The pattern is
strict — `$steps.` prefix, a step key, `.output`, and an optional dotted path:

```ts
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
```

A `SKIPPED` step's `StepRuntimeInfo` has no `output` at all (`ExecutionService.runStep`'s
condition-skip branch returns `runtime: { status: 'SKIPPED' }`, nothing else), so a reference into it
always comes back `found: false` rather than throwing — which is exactly what makes a fallback chain
necessary and sufficient for the IF-EXISTS/ELSE case: only one of `update_existing`/`create_new` ever
has real output, and the caller doesn't have to know at authoring time which one:

```ts
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
```

Any non-`$steps.`-prefixed value — a literal string, number, whatever the model or template supplied
— passes through `resolveParamValue` untouched, so ordinary literal params need no special casing.
Only a value that looks like a reference is parsed at all, and the whole chain fails loud (an
uncaught `Error`, surfacing through `ExecutionService.runStep`'s existing `catch` as a step failure)
rather than silently handing a tool `undefined` for a parameter it expected — a plan author who
forgets a fallback for a branch that might not run gets a clear execution-time error, not a
mysteriously-null field reaching `execute()`.

Resolution happens exactly once per step, immediately before that step's tool body runs — never at
plan-build time, since an upstream step's real output doesn't exist yet then:

```ts
const resolvedParams = resolveStepParams(step.params, runtime);
const schemaCheck = await this.validation.validateParams(tool, resolvedParams);
```

(`ExecutionService.runStep`, inside its per-attempt retry loop — so a retried step re-resolves its
references against whatever `runtime` looks like at the time of that attempt, though in practice
`runtime` only grows once earlier layers have already fully settled.)

## Condition registry

`condition-registry.ts` is deliberately small — plain predicate functions, not full `Tool`s, since a
condition is a read-only check with no approval or rollback semantics of its own:

```ts
/**
 * Plan-step conditions (Phase 6) are plain predicate functions, not full
 * Tools — they're read-only checks with no approval/rollback semantics of
 * their own, evaluated fresh immediately before the step that declares them
 * runs (never cached from plan-creation time — that's the whole point of
 * "IF EXISTS", checking live state). See docs/planner.md.
 */

export type ConditionPredicate = (organizationId: string, args: Record<string, unknown>) => Promise<boolean>;

const CONDITIONS: Record<string, ConditionPredicate> = {
  /** Used by the `create_project`/`update_project` IF-EXISTS/ELSE plan template — see `apps/web/features/planner/services/planner.service.ts`. */
  async project_exists_by_title(organizationId, args) {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) return false;
    const project = await prisma.project.findFirst({ where: { organizationId, title } });
    return project !== null;
  },
};

export function isKnownConditionPredicate(name: string): boolean {
  return name in CONDITIONS;
}

export async function evaluateCondition(organizationId: string, condition: StepCondition): Promise<boolean> {
  const predicate = CONDITIONS[condition.predicate];
  if (!predicate) throw new Error(`Unknown condition predicate: "${condition.predicate}".`);

  const result = await predicate(organizationId, condition.args);
  return condition.negate ? !result : result;
}
```

`CONDITIONS` holds exactly one predicate today, `project_exists_by_title`. It's a plain, hardcoded
`Record`, checked at plan-build time by `PlannerService.validateConditionPredicates`
(`isKnownConditionPredicate`, throws `ValidationError` for an unrecognized name before a plan is even
persisted) and evaluated for real by `ExecutionService.runStep` (`evaluateCondition`) immediately
before that step would otherwise run — "evaluated fresh... never cached from plan-creation time"
means a project created by an earlier step in the *same* plan, or by an entirely different user in
the seconds between plan approval and execution, is visible to the check; it queries live
`prisma.project` state, not a snapshot taken when the plan was built. `negate: true` on a
`StepCondition` flips the result, which is exactly how the ELSE half of IF-EXISTS/ELSE is expressed
using the same single predicate as the IF half.

## The IF-EXISTS/ELSE pattern: `create_project` / `update_project`

The pattern's whole point: a user who says "create a project called Acme Migration" shouldn't get a
duplicate if a project with that title already exists — but the model proposing the action doesn't
know, and shouldn't have to know, whether one already does. `PlannerService.expandRequest` is where
that ambiguity gets resolved deterministically, in code, before a plan is ever built:

```ts
/**
 * `create_project` alone expands into the IF-EXISTS/ELSE two-step
 * conditional pair (`update_project` if a project with that title
 * already exists, `create_project` if not) — see docs/planner.md for why
 * this is deterministic, code-driven structuring rather than something
 * the LLM has to orchestrate itself.
 */
private expandRequest(request: PlanRequest): ExecutionStepDefinition[] {
  if (request.kind === 'compound') {
    return request.steps.map((step) => ({
      key: step.key,
      toolKey: step.toolKey,
      version: step.version ?? '1',
      params: step.params,
      dependsOn: step.dependsOn ?? [],
      retry: step.retry,
    }));
  }

  if (request.toolKey === 'create_project') {
    const title = typeof request.params.title === 'string' ? request.params.title : '';
    if (!title) throw new ValidationError('A project title is required.');

    return [
      {
        key: 'update_existing',
        toolKey: 'update_project',
        version: '1',
        params: {
          lookupTitle: title,
          description: request.params.description,
          status: request.params.status,
          priority: request.params.priority,
        },
        dependsOn: [],
        condition: { predicate: 'project_exists_by_title', args: { title } },
      },
      {
        key: 'create_new',
        toolKey: 'create_project',
        version: request.version ?? '1',
        params: request.params,
        dependsOn: [],
        condition: { predicate: 'project_exists_by_title', args: { title }, negate: true },
      },
    ];
  }

  return [{ key: 'step_0', toolKey: request.toolKey, version: request.version ?? '1', params: request.params, dependsOn: [] }];
}
```

Reading this against the DAG mechanics above: a single `<<ACTION:create_project>>{...}` marker from
the model — `PlanRequest { kind: 'single', toolKey: 'create_project', params }` — becomes **two**
steps, `update_existing` and `create_new`, both with `dependsOn: []` (so `computeLayers` places them
in the same first layer, run concurrently via `Promise.all`), and complementary conditions on the
*same* predicate (`project_exists_by_title`, one plain and one `negate: true`). At execution time,
`evaluateCondition` runs both checks independently; by construction exactly one comes back `true` and
the other `false`, so exactly one branch's tool body actually runs while the other is marked
`SKIPPED` — never both, never neither. This is precisely the scenario "terminal state satisfies a
dependency" above exists for: if some third step depended on "whichever of these two ran," it would
need both `update_existing` and `create_new` to count as finished the instant either resolves,
`SKIPPED` included.

This is what `update_project`'s `lookupTitle` param (rather than a caller-supplied project id) is
for — the template above builds the `update_existing` step's params using only the *title* the user
supplied, since at plan-build time there is no id to supply; `update_project`'s own `validate()` and
`execute()` both re-look-up the project by that title against `ctx.organizationId` at their own call
time.

The model itself never orchestrates this branching — it emits one marker,
`<<ACTION:create_project>>{"title": "...", ...}`, exactly like proposing any other single action;
`expandRequest`'s `create_project` special case is the only place the two-step conditional structure
is built, and it's unconditional, deterministic code, not something an LLM's output shape controls.
Every other single-tool request (the `else` fallthrough, `return [{ key: 'step_0', ... }]`) stays a
plain one-step plan — the IF-EXISTS/ELSE expansion is specific to `create_project`, not a general
mechanism every tool gets automatically.

## Intent Detection: folded into the existing planning loop

`intent-detection.service.ts`'s own doc comment states both what this file is and, explicitly, why it
isn't a separate classifier stage:

```ts
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
```

**Why folding this in is correct**, concretely, not just as an assertion: Phase 5's own bounded
tool-calling loop in `rag-pipeline.service.ts` already spends one non-streamed `provider.generate()`
call per planning iteration (`BOND_MAX_TOOL_CALLS`, default 3, docs/tool-calling.md) deciding whether
the model wants to call a read tool this turn. A dedicated up-front intent classifier — a separate
"is this a write request?" model call before that loop even starts — would be a second LLM round-trip
paying for exactly the same kind of decision the planning loop's `generate()` call is already making.
Phase 6 instead widens what a single planning turn's response can mean: `rag-pipeline.service.ts`
appends a second system message, `buildActionInstructions()`, right alongside Phase 5's existing
`TOOL_INSTRUCTIONS`, onto the *same* messages array, before the *same* loop's *same* `generate()`
call:

```ts
messages = [
  messages[0]!,
  { role: 'system', content: TOOL_INSTRUCTIONS },
  { role: 'system', content: buildActionInstructions() },
  ...messages.slice(1),
];
```

`buildActionInstructions()` itself pulls the available action tools from the live registry rather
than hardcoding a tool list — the same Tool Discovery principle Phase 5 already applied to read
tools, now applied to writes:

```ts
/**
 * Tool Discovery (Phase 6 spec: "AI must never hardcode tool names") — the
 * available write-action tools are listed from the live registry, not a
 * hardcoded string, mirroring `TOOL_INSTRUCTIONS`' own reasoning above but
 * for writes instead of reads.
 */
function buildActionInstructions(): string {
  const tools = getToolRegistryService().list();
  const toolLines = tools.map((tool) => `${tool.toolKey}{...} — ${tool.description}`).join(' ');

  return [
    'If the user is asking you to CREATE, UPDATE, or ARCHIVE something (not just asking a question), you may propose an action instead of answering directly.',
    'This NEVER executes anything by itself — the user must explicitly approve it afterward.',
    'To propose a single action, reply with ONLY one line: <<ACTION:tool_key>>{"param":"value"}',
    `Available action tools: ${toolLines}`,
    'For a multi-step request (e.g. "create a project with tasks and a kickoff meeting"), reply with ONLY one line: <<ACTION:plan>>{"summary":"...","steps":[{"key":"s1","toolKey":"create_project","params":{...},"dependsOn":[]},{"key":"s2","toolKey":"create_task","params":{"projectId":"$steps.s1.output.id","title":"..."},"dependsOn":["s1"]}]}',
    'Do not propose an action for a question that only needs information — use a <<TOOL:...>> read for that instead.',
  ].join(' ');
}
```

Each planning turn's single response is then checked for an action marker *before* it's checked for
a read-tool marker, and the two are treated as mutually exclusive — a response can propose a write or
call a read tool this turn, never both:

```ts
// Action markers take precedence over (and are mutually exclusive
// with) read-tool markers each planning iteration — a response
// containing both is malformed, matching `parseToolCall`'s own
// "malformed -> not a call" posture, so it falls through to the
// no-tool-call `break` below rather than acting on either.
const hasAction = containsActionMarker(plan.content);
const toolCall = hasAction ? null : parseToolCall(plan.content);
```

If an action marker is present and parses, the turn proposes a write and **ends immediately** — no
final `provider.stream()` call happens for that turn, because there's no prose answer to stream; the
"content" the user sees is the deterministic plan summary `proposeWriteAction` already persisted:

```ts
if (hasAction) {
  const actionRequest = parseActionCall(plan.content);
  if (actionRequest) {
    const proposedEvent = await proposeWriteAction({ organizationId, userId, conversationId }, actionRequest);
    yield proposedEvent;
    ...
    // The turn ends here — no final `stream()` call. The "content"
    // for this turn IS the deterministic plan summary already
    // persisted inside `proposeWriteAction`, not LLM-streamed text.
    return;
  }
  break;
}
```

So folding intent detection into the existing loop costs nothing extra in LLM calls — the same
bounded number of `generate()` turns Phase 5 already budgets per answer now also carries the option
to propose a write, rather than intent detection being a new stage that runs before or after that
budget.

`parseActionCall` mirrors Phase 5's `parseToolCall` fail-closed posture exactly: an unparseable or
wrong-shaped marker is treated as "no action," never a crash — the surrounding text is left to be
handled as an ordinary read-tool check or prose answer instead:

```ts
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
```

## The compound `<<ACTION:plan>>` marker: the model proposes, `PlannerService` validates

`<<ACTION:plan>>` is the one marker shape that lets the model itself propose a *multi-step* DAG in
one turn — `summary`, `steps[]`, each step with its own `key`/`toolKey`/`params`/`dependsOn` — rather
than being limited to one tool call per turn the way `<<TOOL:...>>` and single-action
`<<ACTION:tool_key>>` both are. A well-formed example, following exactly the shape
`buildActionInstructions()` shows the model, chaining the three sequential reference tools
(docs/tool-execution.md):

```json
<<ACTION:plan>>{"summary":"Set up the Acme Migration project","steps":[
  {"key":"s1","toolKey":"create_project","params":{"title":"Acme Migration"},"dependsOn":[]},
  {"key":"s2","toolKey":"create_task","params":{"title":"Kickoff prep","projectId":"$steps.s1.output.id"},"dependsOn":["s1"]},
  {"key":"s3","toolKey":"create_meeting","params":{"title":"Kickoff","projectId":"$steps.s1.output.id","meetingDate":"2026-08-01"},"dependsOn":["s1"]}
]}
```

Two things worth noting about what the model can and cannot express this way, both visible directly
in `RawStepRequest`'s type (`plan-request.ts`):

```ts
export interface RawStepRequest {
  key: string;
  toolKey: string;
  version?: string;
  params: Record<string, unknown>;
  dependsOn?: string[];
  retry?: RetryPolicy;
}
```

There is no `condition` field. A model proposing a compound plan can declare `dependsOn` (so `s2` and
`s3` above both wait on `s1`, and — since neither depends on the other — land in the same layer and
run concurrently once `s1` succeeds) and `retry`, but it cannot attach a `StepCondition` to a step;
the IF-EXISTS/ELSE conditional structure is only ever built by `expandRequest`'s hardcoded
`create_project` template, never by anything an LLM's JSON payload controls. `isRawStepRequest`
(intent-detection.service.ts) is the structural gate before any of this even becomes a `PlanRequest`:
`key`/`toolKey` must be strings, `params` an object, `dependsOn` (if present) an array of strings —
anything else and `parseActionCall` returns `null`, same fail-closed posture as every other marker in
this codebase.

None of that is where trust actually ends, though — `parseActionCall`'s structural check is a
prerequisite, not a substitute, for what `PlannerService.buildPlan` does next with a `{ kind:
'compound', ... }` request. `expandRequest`'s `compound` branch (quoted in full above) does the
least possible transformation — mapping each `RawStepRequest` 1:1 to an `ExecutionStepDefinition`,
defaulting `version` to `'1'` when the model omitted it and `dependsOn` to `[]` — and then
`buildPlan`'s pipeline puts every field the model supplied through the same checks a hand-built
compound plan would face:

```ts
async buildPlan(ctx: ToolContext, request: PlanRequest): Promise<BuiltPlan> {
  const stepDefs = this.expandRequest(request);
  validatePlanSteps(stepDefs);
  this.validateConditionPredicates(stepDefs);

  const tools = this.resolveTools(stepDefs);
  await this.validateSteps(ctx, stepDefs, tools);

  const graph = computeLayers(stepDefs);
  const estimatedTimeMs = await this.estimateTotal(ctx, stepDefs, tools);
  const requiredRole = this.permission.requiredRoleForTools(tools);
  const rollbackStrategy = this.computeRollbackStrategy(tools);
  const summary = this.buildSummary(request, stepDefs, tools);
  const planHash = this.computeHash(stepDefs);

  const plan = await createExecutionPlan({ ... steps: stepDefs, graph, planHash, ... });
  return { plan, requiredRole };
}
```

Step by step, what the model's raw JSON cannot get past:

1. **`validatePlanSteps`** — rejects a duplicate `key`, or a `dependsOn` naming a step key the model
   didn't actually include in its own `steps` array.
2. **`validateConditionPredicates`** — a no-op today in practice (the model can't set `condition` at
   all), but there structurally so a future capability change can't silently accept an unknown
   predicate name.
3. **`resolveTools`** — every `toolKey`/`version` pair must resolve against the live
   `ToolRegistryService`; a hallucinated or unregistered tool name throws `ValidationError` here, well
   before any approval card is shown.
4. **`validateSteps`** — every step's `params` are checked against that tool's own Zod `parameters`
   schema immediately, regardless of whether the params contain `$steps.*` references. Full business
   `validate()` also runs immediately for any step whose params are fully concrete right now; a step
   referencing an upstream step's not-yet-real output is deliberately *deferred*, not skipped — the
   comment is explicit that this is correct timing, not a gap:

   ```ts
   /**
    * Schema-shape validation runs for every step immediately (satisfies the
    * lifecycle's "Parameter Validation" stage happening before Preview/
    * Approval). Full business `validate()` also runs immediately for steps
    * whose params are fully known now; steps referencing `$steps.*` output
    * from an upstream step (only possible in compound plans) can't be
    * business-validated until that value actually exists, so it's deferred
    * to `ExecutionService`'s mandatory pre-execution check for that step —
    * never skipped, just correctly timed.
    */
   ```

5. **`computeLayers`** — a cycle among the model's own `dependsOn` claims (`s1` depending on `s2`
   which depends on `s1`) throws `PlanGraphError` here, not at execution time.
6. **`estimateTotal`** / **`requiredRoleForTools`** / **`computeRollbackStrategy`** — the plan's
   time estimate, the role required to approve it, and its overall rollback tier are all computed
   from what the *resolved tools* declare, never from anything the model claimed about itself.
7. **`buildSummary`** — uses the model's own `summary` string for a compound plan's headline (still
   just a label — every actual step description under it comes from `tool.describe(step.params)`,
   i.e. from validated, parsed params, never raw LLM text), or, for a single action, is built
   entirely from `describe()` calls with no LLM-authored text at all.
8. **`computeHash`** — a canonical form of the final, validated step list (params, `dependsOn`
   sorted, `condition`/`retry` defaulted to `null` when absent) hashed with `@bond-os/parsers`'
   existing sha256 `hashContent` utility, independent of whatever key ordering the model's JSON
   happened to use:

   ```ts
   private computeHash(steps: ExecutionStepDefinition[]): string {
     const canonical = steps.map((step) => ({
       key: step.key,
       toolKey: step.toolKey,
       version: step.version,
       params: step.params,
       dependsOn: [...step.dependsOn].sort(),
       condition: step.condition ?? null,
       retry: step.retry ?? null,
     }));
     return hashContent(JSON.stringify(canonical));
   }
   ```

   `ExecutionService.executeApprovedPlan` recomputes this same hash from the *stored* steps right
   before running anything and hard-fails on a mismatch (docs/tool-execution.md) — so even after a
   compound plan clears every check above and gets approved, what actually executes is verified to be
   byte-for-byte the same steps that were validated, not just structurally similar ones.

Only after all of that does `plan-proposal.service.ts`'s `proposeAction` — the shared function both
Mr. Bond's in-pipeline `<<ACTION:...>>` handling and the standalone `POST /api/execution/plan` route
call, "so both callers describe a proposed plan identically instead of two slightly different
implementations drifting apart" — request approval and build the human-readable step list the
approval card actually renders, again from `registry.get(...).describe(step.params)`, never from the
marker text itself:

```ts
const steps: ProposedStepSummary[] = stepDefs.map((step) => {
  const tool = registry.get(step.toolKey, step.version);
  const summary = tool ? tool.describe(step.params) : `${step.toolKey} (unregistered)`;
  return {
    key: step.key,
    toolKey: step.toolKey,
    displayName: tool?.displayName ?? step.toolKey,
    summary: step.condition ? `${summary} (conditional — branch determined at execution time)` : summary,
  };
});
```

That's the concrete meaning of "PlannerService then validates/structures/hashes rather than trusting
as-is": a model can *propose* an arbitrarily creative multi-step DAG, but nothing it writes ever
becomes the record of truth — the `ExecutionPlan` row, the approval card's text, and the hash that
gates execution are all rebuilt from validated, tool-resolved data before anyone ever sees or
approves them.

## What's deliberately not built

- **No conditions in model-proposed plans.** `RawStepRequest` has no `condition` field at all — the
  only source of a `StepCondition` anywhere in this codebase is `expandRequest`'s hardcoded
  `create_project` template. An LLM cannot propose its own IF-EXISTS/ELSE branching today, even
  though the DAG/condition-registry machinery that would run it already exists and is exercised by
  that one template.
- **No nested or recursive plan grammar.** Covered above — every plan, template-built or
  model-proposed, is a flat `ExecutionStepDefinition[]`. There is no sub-plan, no step whose `params`
  or structure embeds another plan.
- **No dynamic condition registry.** `CONDITIONS` is a compile-time `Record` with exactly one entry,
  `project_exists_by_title`. Adding a new predicate is a source change to `condition-registry.ts`,
  checked at plan-build time (`isKnownConditionPredicate`) so an unrecognized name fails before a
  plan is ever persisted, not partway through execution.
- **No separate intent-classification model call.** Covered in full above — Phase 6 widens Phase 5's
  existing bounded planning loop's system prompt rather than adding a new LLM round-trip before or
  after it.
- **No plan-level retry, only per-step.** `RetryPolicy { maxAttempts, backoffMs }` lives on
  `ExecutionStepDefinition`, not on the plan as a whole, and a step's default is `maxAttempts: 1` (no
  retry) unless it explicitly opts in.
- **No execution from this layer.** `PlannerService.buildPlan` ends at `createExecutionPlan` — it
  persists the `ExecutionPlan` row and returns; it never itself creates the `ApprovalRequest`
  (that's `proposeAction`'s job, one caller up, docs/approvals.md) and never creates a `ToolExecution`
  row at all. Nothing in `apps/web/features/planner/` calls a tool's `execute()`; that's
  `ExecutionService`'s job alone, and only after approval (docs/tool-execution.md).

## Documentation index

- **[docs/tool-execution.md](./tool-execution.md)** — the framework this Planner feeds: the 7-model
  schema, the 8-method Tool SDK, the registry's single-source-of-truth import graph, the 5 reference
  tools, and the composition root.
- **docs/approvals.md** — the approval gate an `ExecutionPlan` this service builds is handed to next.
- **docs/rollback.md** — what happens to a plan's already-succeeded steps if a later step fails
  mid-execution.
- **[docs/tool-calling.md](./tool-calling.md)** / **[docs/rag.md](./rag.md)** — Phase 5's read-only
  tool-calling loop and the RAG pipeline this phase's Intent Detection is folded into.
