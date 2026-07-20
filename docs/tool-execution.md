# Tool Execution Framework (Phase 6)

## Scope

Phase 5 gave Mr. Bond nine read-only tools and a hard structural guarantee that none of them could
ever write (docs/tool-calling.md). Phase 6 is the deliberate, narrow next step: a generic,
approval-gated framework so Mr. Bond can *propose* a write and — only after a human explicitly
approves it — actually perform it. `packages/database/prisma/schema.prisma`'s Phase 6 section states
the whole design in its own header comment:

```prisma
// ── Phase 6: Tool Execution Framework ───────────────────────────────────────
// A generic, approval-gated framework so Mr. Bond can propose and — only
// after explicit user approval — execute writes. The read-only tool-calling
// path from Phase 5 (apps/web/features/bond/services/tool-calling.service.ts)
// is untouched by this section entirely. A Tool's actual BEHAVIOR (validate/
// preview/execute/rollback) lives in code (apps/web/features/tools/), never
// in the DB — functions aren't storable — the `Tool` model below is a
// queryable metadata snapshot synced from the in-memory registry, not the
// execution hot path. See docs/tool-execution.md, docs/planner.md,
// docs/approvals.md, docs/rollback.md.
```

Concretely, this phase is five pieces, each documented below: a **7-model/6-enum data model**
(`Tool`, `ExecutionPlan`, `ApprovalRequest`, `ToolExecution`, `ExecutionStep`, `RollbackRecord`,
`AuditEvent`); a generic **8-method Tool SDK** (`apps/web/features/tools/lib/tool-definition.ts`)
that every concrete tool implements identically; an in-memory **registry** that is the only place
a concrete tool is ever imported (`apps/web/features/tools/registry.ts` +
`tool-registry.service.ts`); **5 reference tools** under `apps/web/features/tools/definitions/`
that prove the SDK against real, pre-existing project/task/meeting services; and a **composition
root** (`apps/web/features/execution/lib/container.ts`) that wires the resulting engine together
with plain constructor injection. The Plan Graph the engine executes — how a natural-language
request becomes a validated, hashed DAG of steps — is its own concern, covered in docs/planner.md.
The approval gate and rollback mechanics get their own docs (docs/approvals.md, docs/rollback.md);
this doc is the framework's shape, not those two subsystems' internals.

Phase 5's tool-calling path is untouched by any of this — `tool-calling.service.ts` imports nothing
from `apps/web/features/tools/`, `apps/web/features/planner/`, or `apps/web/features/execution/`,
and nothing in this phase imports from `apps/web/features/bond/services/tool-calling.service.ts`
either. The two systems are read-only-tools-for-answers (Phase 5) and
write-tools-behind-approval (Phase 6), living side by side, never calling into each other.

## The data model: 7 models, 6 enums

Every model's own doc comment states its role precisely; each is quoted here rather than
paraphrased, since the comments are the actual design record.

**`ToolCategory`** (12 values) — `PROJECTS`, `TASKS`, `MEETINGS`, `CUSTOMERS`, `DOCUMENTS`, `NOTES`,
`EMAILS`, `KNOWLEDGE_GRAPH`, `CRM`, `FILES`, `ANALYTICS`, `SYSTEM`. Every registered tool declares
exactly one. See "What's deliberately not built" below for how much of this space the 5 reference
tools actually cover.

**`RollbackSupport`** — `AUTOMATIC | MANUAL | NOT_SUPPORTED`. Declared per-tool and rolled up to a
whole plan's `ExecutionPlan.rollbackStrategy` by "weakest link wins": one `NOT_SUPPORTED` tool in a
plan makes the whole plan `NOT_SUPPORTED`, otherwise one `MANUAL` tool makes it `MANUAL`, otherwise
`AUTOMATIC` (`PlannerService.computeRollbackStrategy`, docs/planner.md).

**`ExecutionStatus`**, the lifecycle a `ToolExecution` moves through:

```prisma
/// A single execution's overall lifecycle state — DRAFT (plan built, not yet
/// previewed) through the approval gate to a terminal SUCCEEDED/FAILED/
/// ROLLED_BACK/CANCELLED. Nothing past AWAITING_APPROVAL is reachable without
/// ApprovalService's atomic status transition — see docs/approvals.md.
enum ExecutionStatus {
  DRAFT
  AWAITING_APPROVAL
  APPROVED
  REJECTED
  EXPIRED
  EXECUTING
  SUCCEEDED
  FAILED
  ROLLING_BACK
  ROLLED_BACK
  CANCELLED
}
```

**`StepStatus`** (`PENDING | RUNNING | SUCCEEDED | FAILED | SKIPPED | ROLLED_BACK`) — a single
step's runtime status; `SKIPPED` is what a step lands in when its `condition` evaluates false (the
IF-EXISTS/ELSE pattern, docs/planner.md). **`ApprovalStatus`**
(`PENDING | APPROVED | REJECTED | EXPIRED | CANCELLED`) and **`RollbackRecordStatus`**
(`PENDING | SUCCEEDED | FAILED`) round out the 6 enums.

The 7 models, each with its schema comment quoted in full:

```prisma
/// Registered-tool metadata, synced from the in-memory ToolRegistry on first
/// access each process lifetime (idempotent upsert by [toolKey, version]).
/// `toolKey` is the stable slug ("create_project"); `id` stays a cuid for FK
/// consistency with every other model in this schema. Not organization-
/// scoped — a registered tool applies to every organization.
model Tool {
  id                   String          @id @default(cuid())
  toolKey              String
  version              String
  name                 String
  displayName          String
  description          String
  category             ToolCategory
  icon                 String
  minimumRole          Role
  parametersSchema     Json
  outputSchema         Json
  supportsRollback     Boolean         @default(false)
  rollbackSupport      RollbackSupport @default(NOT_SUPPORTED)
  supportsPreview      Boolean         @default(true)
  supportsDryRun       Boolean         @default(true)
  supportsTransactions Boolean         @default(true)
  requiresApproval     Boolean         @default(true)
  estimatedExecutionMs Int
  createdAt            DateTime        @default(now())
  updatedAt            DateTime        @updatedAt

  executions ToolExecution[]

  @@unique([toolKey, version])
  @@map("tools")
}
```

```prisma
/// A Planner-built, not-yet-approved plan. `steps`/`graph` are Json — see
/// docs/planner.md for the exact ExecutionStepDefinition/layer shapes. `planHash`
/// (sha256 of the canonicalized steps+params, using @bond-os/parsers' existing
/// `hashContent`) is recomputed at execution time and compared — a mismatch
/// hard-fails rather than executing a possibly-tampered plan.
model ExecutionPlan {
  id               String   @id @default(cuid())
  organizationId   String
  conversationId   String?
  createdById      String?
  summary          String
  steps            Json
  graph            Json
  planHash         String
  estimatedTimeMs  Int
  rollbackStrategy RollbackSupport
  createdAt        DateTime @default(now())

  organization Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  conversation Conversation?    @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  createdBy    User?            @relation("ExecutionPlanCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  approval     ApprovalRequest?
  execution    ToolExecution?

  @@index([organizationId])
  @@map("execution_plans")
}
```

```prisma
/// The approval gate itself. Single-use/replay protection is an atomic,
/// org-scoped conditional `updateMany` (status = PENDING AND not expired ->
/// APPROVED), not a signature — see docs/approvals.md for why a signed token
/// was considered and dropped. `requiredRole` is computed as the max
/// ROLE_HIERARCHY severity across every step's tool in the plan, never
/// client-supplied.
model ApprovalRequest {
  id             String         @id @default(cuid())
  planId         String         @unique
  organizationId String
  requiredRole   Role
  status         ApprovalStatus @default(PENDING)
  approvedById   String?
  approvedAt     DateTime?
  expiresAt      DateTime
  createdAt      DateTime       @default(now())

  plan         ExecutionPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  approvedBy   User?         @relation("ApprovalRequestApprovedBy", fields: [approvedById], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([status])
  @@map("approval_requests")
}
```

```prisma
/// One row per plan execution attempt — mirrors Phase 2's `SyncJob`/Phase 4's
/// `EmbeddingJob` exactly: a single mutable row, `status` enum, nullable
/// `startedAt`/`completedAt`, org-scoped `updateMany` (never bare `update`)
/// for every state transition. Not an append-only log — see `AuditEvent` for
/// that. `toolId` is nullable and only set for single-step plans — a
/// compound multi-step plan spans several tools, each already identified by
/// its own `ExecutionStep.tool` (toolKey); this FK exists for the common
/// single-tool case's convenience, not as the source of truth for which
/// tools ran.
model ToolExecution {
  id             String               @id @default(cuid())
  planId         String               @unique
  toolId         String?
  organizationId String
  conversationId String?
  status         ExecutionStatus      @default(DRAFT)
  startedAt      DateTime?
  completedAt    DateTime?
  duration       Int?
  createdById    String?
  rollbackStatus RollbackRecordStatus @default(PENDING)
  error          String?
  createdAt      DateTime             @default(now())

  plan         ExecutionPlan   @relation(fields: [planId], references: [id], onDelete: Cascade)
  tool         Tool?           @relation(fields: [toolId], references: [id], onDelete: SetNull)
  organization Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  conversation Conversation?   @relation(fields: [conversationId], references: [id], onDelete: SetNull)
  createdBy    User?           @relation("ToolExecutionCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  steps        ExecutionStep[]
  rollback     RollbackRecord?
  auditEvents  AuditEvent[]

  @@index([organizationId])
  @@index([status])
  @@map("tool_executions")
}
```

```prisma
/// One row per DAG step per execution attempt. `tool` stores the toolKey (not
/// an FK) — a step's tool is resolved through the plan's own `steps` Json at
/// plan-build time, and re-validated against the live registry before it
/// runs; `ExecutionPlan`/`ToolExecution` are the source of truth for a step's
/// full definition (params/dependsOn/condition/retry), this row is its
/// runtime status/result.
model ExecutionStep {
  id          String     @id @default(cuid())
  executionId String
  order       Int
  tool        String
  status      StepStatus @default(PENDING)
  duration    Int?
  result      Json?
  rollback    Json?
  createdAt   DateTime   @default(now())

  execution ToolExecution @relation(fields: [executionId], references: [id], onDelete: Cascade)

  @@index([executionId, order])
  @@map("execution_steps")
}
```

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
```

```prisma
/// Immutable, append-only — mirrors `TimelineEvent`'s "never edited or
/// deleted" convention. Distinct from Phase 4's `AiAuditLog` (documented
/// fire-and-forget observability for read/generation calls); this is the
/// compliance trail for write-lifecycle state transitions (plan_created,
/// approved, rejected, step_started, step_succeeded, step_failed,
/// rolled_back, ...).
model AuditEvent {
  id             String   @id @default(cuid())
  organizationId String
  executionId    String?
  userId         String?
  action         String
  metadata       Json?
  createdAt      DateTime @default(now())

  organization Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  execution    ToolExecution? @relation(fields: [executionId], references: [id], onDelete: SetNull)
  user         User?          @relation("AuditEventUser", fields: [userId], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([executionId])
  @@map("audit_events")
}
```

The `ExecutionPlan` comment's `planHash` note matters enough to trace end to end:
`PlannerService.buildPlan` computes it once at plan-build time
(`hashContent(JSON.stringify(canonical))`, `@bond-os/parsers`' existing sha256 helper — no new
hashing utility was written for this), and `ExecutionService.executeApprovedPlan` recomputes it from
the *stored* steps immediately before running anything, hard-failing with a `ConflictError` on a
mismatch rather than trusting that what was approved is still what's about to run — see
docs/planner.md for the canonicalization that makes the hash stable regardless of a model's own JSON
field ordering.

## The Tool SDK: 8 methods, one contract for every tool

`apps/web/features/tools/lib/tool-definition.ts` is the entire interface a tool must implement —
the file's own doc comment is explicit about scope:

```ts
/**
 * The generic Tool SDK (Phase 6). Every tool implements exactly this
 * contract — no custom entry points. The execution engine, planner, and
 * registry only ever call these 8 methods; none of them know what a
 * "Project" or "Task" is. See docs/tool-execution.md.
 */
```

The 8 methods, in the order the lifecycle actually calls them:

```ts
export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  /** The Zod schemas that validate `execute()`'s params and result — also the source of the DB `Tool.parametersSchema`/`outputSchema` JSON Schema snapshot. */
  schema(): { parameters: AnyInputZodType<TParams>; output: AnyInputZodType<TResult> };

  /** The minimum role required to approve a plan containing this tool. Fixed per-tool for every current reference tool; declared as a method (not a static field) so a future tool could vary it by params. */
  permissions(): Role;

  /** A rough execution-time estimate in ms, shown on the approval card. */
  estimate(ctx: ToolContext, params: TParams): Promise<number>;

  /** Structural/business validation beyond the Zod schema — e.g. does a referenced record belong to this organization. Called before a plan is ever shown for approval. */
  validate(ctx: ToolContext, params: TParams): Promise<ToolValidationResult>;

  /** Dry-run: produces a human-readable before/after diff with NO data mutation. */
  preview(ctx: ToolContext, params: TParams): Promise<ToolPreviewResult>;

  /** The real write. Only ever invoked by `ExecutionService` after `ApprovalRequest.status` has atomically transitioned to `APPROVED`. */
  execute(ctx: ToolContext, params: TParams): Promise<TResult>;

  /** Reverses `execute()`'s effect. Only ever invoked when `rollbackSupport !== 'NOT_SUPPORTED'`. */
  rollback(ctx: ToolContext, result: TResult): Promise<void>;

  /** One-line human summary for the approval card, built from validated `params` — never from raw LLM text. */
  describe(params: TParams): string;
}
```

Alongside the 8 methods, every tool also declares 12 static fields — `toolKey`, `version`, `name`,
`displayName`, `description`, `category`, `icon`, `estimatedExecutionMs`, `rollbackSupport`,
`supportsPreview`, `supportsDryRun`, `supportsTransactions`, `requiresApproval` — the exact set that
`Tool.syncToDatabase` later upserts into the DB row and `tool-discovery.service.ts` (`listToolsService`)
serializes back out to a client asking "what tools exist" (spec: "AI must never hardcode tool
names. Instead it requests Available Tools -> Capabilities -> Choose Tool -> Return Tool ID").

Two supporting types make the SDK's other methods meaningful without any tool-specific knowledge:

```ts
export interface ToolContext {
  organizationId: string;
  userId: string;
  conversationId?: string;
}

export interface ToolPreviewChange {
  field: string;
  before: unknown;
  after: unknown;
}
export interface ToolPreviewResult {
  summary: string;
  changes: ToolPreviewChange[];
}
```

And the generic-erasure type every consumer outside a tool's own file actually uses:

```ts
/** Type-erased view used by the registry/engine/planner, which operate on tools generically without knowing any concrete `TParams`/`TResult`. */
export type AnyToolDefinition = ToolDefinition<unknown, unknown>;
```

`AnyInputZodType<Output>` exists purely as a small type-system accommodation: every reference tool's
params schema has `.default(...)` fields, so a schema's raw pre-parse input type (optional fields)
differs from its parsed output type (defaults applied) — plain `ZodType<Output>` can't express that
gap, so the SDK loosens the schema's input generic to `any` while keeping `Output` (what `execute()`
etc. actually receive) exact.

## The registry: the single source of truth

Two files carry this property. `apps/web/features/tools/services/tool-registry.service.ts` is the
generic, tool-agnostic map:

```ts
/**
 * The single source of truth for which tools exist (Phase 6). Concrete tool
 * modules never register themselves globally — `apps/web/features/tools/registry.ts`
 * is the ONLY file that imports every concrete tool and calls `register()`;
 * the Planner/Execution Engine only ever call `get()`/`list()` on an
 * instance of this class, never import a concrete tool module directly.
 * This is what makes "the execution engine knows nothing about Projects/
 * Tasks/Customers/Documents" literally true. See docs/tool-execution.md.
 */
export class ToolRegistryService {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register(tool: AnyToolDefinition): void { ... }
  get(toolKey: string, version: string): AnyToolDefinition | undefined { ... }
  getLatest(toolKey: string): AnyToolDefinition | undefined { ... }
  list(): AnyToolDefinition[] { ... }
  async syncToDatabase(): Promise<void> { ... }
}
```

`apps/web/features/tools/registry.ts` is the one place that closes the loop and actually imports
every concrete tool:

```ts
/**
 * The ONLY file in this codebase that imports every concrete tool
 * definition. `apps/web/features/planner/` and `apps/web/features/execution/`
 * never import a `*.tool.ts` file directly — they only ever call
 * `registry.get(toolKey, version)` / `registry.list()` on the
 * `ToolRegistryService` instance built here, which is what makes "the
 * execution engine knows nothing about Projects/Tasks/Customers/Documents"
 * literally true. See docs/tool-execution.md.
 */
const ALL_TOOLS: AnyToolDefinition[] = [
  createProjectTool as AnyToolDefinition,
  updateProjectTool as AnyToolDefinition,
  createTaskTool as AnyToolDefinition,
  createMeetingTool as AnyToolDefinition,
  archiveProjectTool as AnyToolDefinition,
];

let instance: ToolRegistryService | undefined;

export function getToolRegistry(): ToolRegistryService {
  if (!instance) {
    instance = new ToolRegistryService();
    for (const tool of ALL_TOOLS) instance.register(tool);
  }
  return instance;
}
```

This isn't just an assertion in a comment — it's a checkable property of the codebase. Searching
both consuming feature folders for the concrete service each tool wraps turns up nothing:

```
$ grep -rn "project.service" apps/web/features/execution apps/web/features/planner
(no matches)
```

`ExecutionService` (`apps/web/features/execution/services/execution.service.ts`) resolves a step's
tool with `this.registry.get(step.toolKey, step.version)`; `PlannerService`
(`apps/web/features/planner/services/planner.service.ts`) resolves it with
`this.registry.get(step.toolKey, step.version)` too. Neither file, nor anything else under
`features/execution/` or `features/planner/`, imports `createProjectService`,
`updateProjectService`, `createTaskService`, `createMeetingService`, or any other concrete
project/task/meeting/customer service directly — every one of those imports lives exclusively
inside the 5 files under `apps/web/features/tools/definitions/`. That's the literal mechanism behind
"the execution engine knows nothing about Projects/Tasks/Customers/Documents": it's not a
convention anyone has to remember to follow, it's an import graph a grep can verify.

`syncToDatabase()` is the registry's one piece of DB interaction — an idempotent, memoized
(`syncPromise`), lazy-once-per-process upsert of every registered tool's static metadata into the
`Tool` table, "cheap enough on cold start, same lazy-once-per-process ethos as every other
composition-root singleton in this codebase." It deliberately does not attempt a real Zod-to-JSON-
Schema conversion for `parametersSchema`/`outputSchema` — this codebase has no such utility, and the
comment is direct about what fills that column instead:

```ts
parametersSchema: { note: 'Defined in code; validated via the live Zod schema, not this snapshot.' },
outputSchema: { note: 'Defined in code; validated via the live Zod schema, not this snapshot.' },
```

The DB row exists for discovery and historical display — a `Tool` table you can query and join
against `ToolExecution` — never as the validation hot path. Every real parameter check goes through
the in-memory Zod schema the live `ToolDefinition` object still holds.

## The 5 reference tools

All 5 live under `apps/web/features/tools/definitions/`, each a "thin wrapper" (their own words) over
a pre-existing service — none duplicates business logic that already existed before Phase 6.

| Tool | Wraps | Role | Rollback |
|---|---|---|---|
| `create_project` | `createProjectService` | `MEMBER` | `AUTOMATIC` — deletes the created row via the raw `deleteProject` repository function |
| `update_project` | `updateProjectService` | `MEMBER` | `AUTOMATIC` — restores the pre-update `description`/`status`/`priority` snapshot captured in `execute()`'s own result |
| `create_task` | `createTaskService` | `MEMBER` | `AUTOMATIC` — deletes the created row via `deleteTask` |
| `create_meeting` | `createMeetingService` | `MEMBER` | `AUTOMATIC` — deletes the created row via `deleteMeeting` |
| `archive_project` | `updateProjectService` (sets `status: 'ARCHIVED'`) | `ADMIN` | `AUTOMATIC` — restores the captured `previousStatus` |

All 5 declare `rollbackSupport: 'AUTOMATIC'`, `supportsPreview: true`, `supportsDryRun: true`,
`supportsTransactions: true`, and `requiresApproval: true` — this reference set deliberately proves
out the SDK's strongest, most reversible tier of every capability rather than exercising the
`MANUAL`/`NOT_SUPPORTED` corners the schema also defines (see "What's deliberately not built").

Three things the 5 tools together demonstrate that a single tool alone couldn't:

- **`update_project` resolves its target by title, not id.** Its params schema takes
  `lookupTitle`, not a project id:

  ```ts
  /**
   * Looks the target project up by `lookupTitle` rather than requiring a
   * caller-supplied id — this is what lets the Planner's IF-EXISTS/ELSE
   * template (see `apps/web/features/planner/services/planner.service.ts`)
   * build a valid `update_project` step without knowing the existing
   * project's id at plan-build time, only that one exists by that title.
   */
  ```

  This is what makes the IF-EXISTS/ELSE pattern possible at all — see docs/planner.md.

- **`create_task`/`create_meeting` chain off a project id a prior step just created.** Both take a
  `projectId` param, and both tools' own comments call out that this is intentional: `create_task`'s
  is "the natural dependency-chain target for `$steps.<create_project_step>.output.id` references";
  `create_meeting`'s is "the sequential tail of the create_project -> create_task(s) -> create_meeting
  reference chain." See docs/planner.md for the exact `$steps.*.output.*` resolution mechanism this
  enables.

- **`archive_project` is the one `ADMIN`-tier tool.** Its comment states this directly: "demonstrates
  the permission-tier computation described in docs/approvals.md: a plan mixing this with a
  MEMBER-tier tool requires ADMIN to approve the whole plan, not just this step." Every other
  reference tool is `MEMBER`-tier, so `archive_project` is the only proof, in this phase, that a
  plan's `requiredRole` is computed as the *maximum* severity across its steps rather than fixed at
  `MEMBER`.

`create_project`'s own rollback is worth calling out for what it deliberately avoids:

```ts
async rollback(ctx, result) {
  // Deletes via the raw repository function, not the ADMIN-gated
  // `deleteProjectService` — this tool's own approval tier is MEMBER, and
  // rollback authorization was already established by the plan's original
  // approval, not a fresh independent delete request.
  await deleteProject(result.id, ctx.organizationId);
},
```

Rollback calls the raw `deleteProject` repository function, not the higher-privileged
`deleteProjectService` a human deleting a project through the UI would go through — because
rollback isn't a fresh user action requiring its own authorization check, it's the reversal of a
write that was already approved once.

## The composition root: `container.ts`

`apps/web/features/execution/lib/container.ts` is the one place every Phase 6 service is
constructed:

```ts
/**
 * The composition root (Phase 6) — every new service is a class with
 * constructor-injected dependencies, wired up exactly once here, mirroring
 * the `getAIProvider()`/`getEmbeddingProvider()`/`getCache()`/`getQueue()`
 * lazy-singleton pattern already used throughout this codebase. No call
 * site anywhere writes `new ExecutionService(...)` directly. See
 * docs/tool-execution.md.
 */
```

Every service is a plain class taking its dependencies as constructor parameters — no interfaces,
no `@Injectable()` decorators, no reflection-based container, no third-party DI package. The whole
mechanism is 8 lazily-initialized module-level variables and 8 `getX()` functions:

```ts
export function getToolRegistryService(): ToolRegistryService {
  if (!toolRegistryService) toolRegistryService = getToolRegistry();
  return toolRegistryService;
}

export function getPlannerService(): PlannerService {
  if (!plannerService) {
    plannerService = new PlannerService(getToolRegistryService(), getValidationService(), getPermissionService());
  }
  return plannerService;
}

export function getRollbackService(): RollbackService {
  if (!rollbackService) rollbackService = new RollbackService(getAuditService());
  return rollbackService;
}

export function getExecutionService(): ExecutionService {
  if (!executionService) {
    executionService = new ExecutionService(
      getToolRegistryService(),
      getValidationService(),
      getApprovalService(),
      getAuditService(),
      getRollbackService(),
      getPlannerService(),
    );
  }
  return executionService;
}
```

The dependency graph this builds, bottom to top: `ToolRegistryService`, `ValidationService`,
`PermissionService`, `AuditService`, and `ApprovalService` have no dependencies of their own;
`PlannerService` depends on the registry, validation, and permission services; `RollbackService`
depends on `AuditService`; and `ExecutionService` — the top of the graph — depends directly on the
registry, validation, approval, audit, and rollback services, plus `PlannerService` (which pulls in
`PermissionService` transitively). `ExecutionService` is the one an API route actually calls
(`/api/execution/[id]/approve`); `PlannerService` is called both from there indirectly (via
`ExecutionService`'s own `hashSteps` re-check) and directly by `plan-proposal.service.ts`'s
`proposeAction`, the function both Mr. Bond's in-pipeline action handling and
`POST /api/execution/plan` share.

Why constructor injection instead of a DI framework: this is the same lazy-singleton shape every
other cross-cutting dependency in the codebase already uses (`getAIProvider()`,
`getEmbeddingProvider()`, `getCache()`, `getQueue()`) — a `let` binding, a null check, one
constructor call. Adding a DI framework (decorators, a module system, a reflection-based container)
would introduce a second way of wiring dependencies alongside a pattern that already works
everywhere else in this codebase, for a graph that's currently 8 nodes deep and fully known at
compile time — there's no runtime plugin loading, no conditional wiring, nothing a heavier framework
would buy that plain constructors and one `let`-per-service don't already provide. And exactly like
the registry's import-graph guarantee above, "no call site anywhere writes `new ExecutionService(...)`
directly" is checkable, not just claimed: every one of `ExecutionService`, `PlannerService`,
`ApprovalService`, `AuditService`, `RollbackService`, `ValidationService`, and `PermissionService` is
constructed exactly once, inside `container.ts`, and nowhere else in `apps/web`. (`ToolRegistryService`
is the one exception worth naming explicitly: it's constructed inside `registry.ts`'s own
`getToolRegistry()` — the tool-registration composition root described above — and `container.ts`'s
`getToolRegistryService()` simply wraps that same singleton, rather than constructing a second one.)

## What's deliberately not built

- **No `send_email` tool.** `EMAILS` is a real `ToolCategory` value, and Phase 5's own read-only
  `'emails'` tool already lists past emails as context (docs/tool-calling.md) — but nothing under
  `apps/web/features/tools/definitions/` sends one, and `ALL_TOOLS` in `registry.ts` has exactly 5
  entries, none named anything like `send_email`. This isn't an oversight this doc is papering over:
  every one of the 5 reference tools was chosen to demonstrate `rollbackSupport: 'AUTOMATIC'` — a
  clean, symmetric undo (delete what was created, restore what was overwritten). Sending an email has
  no such undo; once delivered, it cannot be unsent. Building `send_email` as this phase's proof
  tool would have meant either declaring `rollbackSupport: 'NOT_SUPPORTED'` on the very first
  reference tool (undercutting what the reference set is meant to prove) or pretending an unsend
  operation exists where none can. The framework itself doesn't prevent a future `NOT_SUPPORTED`
  tool — the enum, the schema's `rollbackStrategy` weakest-link computation, and `RollbackService`'s
  own `NOT_SUPPORTED` branch (`allOk = false; ... 'Rollback not supported for this tool.'`) all
  already handle that case — it's simply not what this phase chose to demonstrate first.

- **No broad multi-category tool coverage.** `ToolCategory` has 12 values; the 5 reference tools
  touch exactly 3 of them (`PROJECTS` x3, `TASKS` x1, `MEETINGS` x1). `CUSTOMERS`, `DOCUMENTS`,
  `NOTES`, `EMAILS`, `KNOWLEDGE_GRAPH`, `CRM`, `FILES`, `ANALYTICS`, and `SYSTEM` have zero
  registered tools. This phase is a framework proof — the SDK, the registry, the DAG, the approval
  gate, the rollback mechanism — not an attempt at full write coverage across every category BOND OS
  already has read surfaces for. Extending coverage to a new category is, by the registry's own
  design, a matter of adding one `*.tool.ts` file and one line in `ALL_TOOLS` — nothing about
  `ExecutionService`, `PlannerService`, or the DB schema needs to change to support it, which is the
  entire point of routing every category through one generic 8-method contract instead of building
  category-specific execution paths.

- **No custom entry points per tool.** The SDK's own doc comment says this outright: "no custom
  entry points." A tool cannot expose an extra method, a different call signature, or a bypass around
  `validate()`/`preview()`/`execute()`/`rollback()` — the engine, planner, and registry only ever call
  the same 8 methods on every tool, `AnyToolDefinition`-typed, regardless of what the tool actually
  does underneath.

- **No dynamic/plugin tool loading.** `ALL_TOOLS` is a literal array in `registry.ts`, populated at
  module load. There is no filesystem scan, no dynamic `import()`, no admin UI for uploading a new
  tool — adding a tool is a source-code change to `registry.ts`, reviewable exactly like any other
  code change, not something reachable at runtime.

- **No execution without approval.** Every reference tool declares `requiresApproval: true`, and
  `ExecutionService.executeApprovedPlan`'s very first line is `await
  this.approvalService.approve(...)` — "Everything below this line only runs because this succeeded."
  There is no code path in this phase from a built `ExecutionPlan` to a running `ToolExecution` that
  skips the approval gate; see docs/approvals.md for that gate's own mechanics.

## Documentation index

- **docs/planner.md** — the Plan Graph (`dag.ts`), the condition registry, the IF-EXISTS/ELSE
  templating `create_project`/`update_project` use, Intent Detection folded into Mr. Bond's existing
  planning loop, and the `<<ACTION:plan>>` compound-plan marker.
- **docs/approvals.md** — the approval gate itself: `ApprovalRequest`'s atomic single-use transition,
  `requiredRole` computation, and expiry.
- **docs/rollback.md** — `RollbackService`'s reverse-order, best-effort undo of a failed execution's
  already-succeeded steps, and why a failed rollback is recorded rather than swallowed.
- **[docs/tool-calling.md](./tool-calling.md)** — Phase 5's read-only tool-calling loop, untouched by
  this phase, and the structural reason it can never reach a write.
