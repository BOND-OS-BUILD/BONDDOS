# Architecture Decisions

Recorded as ADRs — Context, Decision, Consequences — for the biggest structural decisions actually made
in this codebase. Each is grounded in a real doc comment or file read directly from source, cited
throughout; none of these are inferred from the shape of the code alone.

## ADR-001: SSE over WebSockets for realtime

**Status:** Accepted, implemented (Phase 9).

**Context.** Before Phase 9, nothing in this codebase held a persistent bidirectional connection — three
routes (`/api/bond/chat`, `/api/agents/chat`, `/api/execution/[id]/approve`) already streamed one-shot
progress over SSE, each running one generator to completion and closing. Phase 9 needed a transport for
*continuously*-live data — presence, unread counts, live comments — and the natural next step for that
shape is usually WebSockets. But this application's own deployment story commits to two different
targets at once: the root README states `Deployment: Docker (multi-stage), Vercel-compatible`, and
`docker-compose.yml`'s `web` service (a persistent Node process) is gated behind `profiles: [full]`, not
the default local-dev path. A real WebSocket server is a first commitment to "this always runs as a
long-lived container" — a constraint nothing before Phase 9 had introduced.

**Decision.** Generalize the existing one-shot SSE pattern into a reconnecting poll loop
(`apps/web/features/collaboration/lib/realtime-channel.ts`'s `channelStream()`), instead of adding a
WebSocket server. A connection opens, emits a snapshot immediately, then polls roughly every 2.5 seconds,
emitting a new `snapshot` event only when the serialized content actually changed. After
`STREAM_DURATION_MS` (25 seconds — a safety margin under the route's `maxDuration = 30`), the generator
emits one final `{ type: 'reconnect' }` event and returns; the **client** is responsible for reopening
the connection, so the mechanism works identically whether the platform kills idle functions at 10
seconds or 15 minutes.

**Consequences.**
- Works unmodified on both deployment targets (Docker and Vercel) without picking one — the explicit
  goal.
- Every "live" surface (Presence, Notifications, the Activity Feed, Live Dashboards) shares one generic
  primitive instead of four bespoke transports.
- Latency is bounded by the poll interval and snapshot TTL, not sub-second — this is "continuously live,"
  not "instant." `docs/collaboration.md` states this trade-off plainly: "No guaranteed sub-3-second
  latency."
- No persistent Postgres connection pooler (PgBouncer, a managed Data Proxy) is configured anywhere in
  this repository — holding a serverless invocation open for up to ~25 seconds per concurrent SSE viewer
  is a materially different connection-lifetime profile than any pre-Phase-9 route. This is called out as
  an unaddressed operational prerequisite, not solved in code — see [scalability.md](./scalability.md).

See [Collaboration](../collaboration.md) for the full transport mechanics.

## ADR-002: Atomic `updateMany` over signed tokens for approval single-use

**Status:** Accepted, implemented (Phase 6).

**Context.** An `ApprovalRequest` is the single gate between a proposed plan and every write BOND OS's
Tool Execution Framework can perform. Two properties must hold: single-use (once approved/rejected, no
replay or double-click can flip the outcome again) and race-safety (two concurrent approve calls must not
both succeed). A natural first design is a signed, bearer-style token — sign `{ planId, organizationId,
requiredRole, expiresAt }`, hand the signature to the approver, verify it on `/approve`. It was
considered and dropped for three concrete reasons, each documented directly in
`docs/security/approvals.md`:

1. A signature proves a token's *claims* weren't altered — it says nothing about whether that exact,
   still-valid token has already been redeemed. Solving replay still requires a server-side "already
   consumed" flag, checked and set atomically, which fully subsumes what the signature would have added.
2. There is no off-system channel in this flow for a signature to authenticate across — `/approve` runs
   inside an authenticated, same-origin session (`requireAuth()`/`requireRole()` + `assertSameOrigin`),
   unlike an emailed magic link or a cross-service webhook callback.
3. The values a token would protect from tampering (`requiredRole`, plan content) are never
   client-supplied in the first place — `requiredRole` is computed server-side at plan-build time and
   stored on the row; `/approve` only ever receives `planId` from the client, used purely to look the
   authoritative row up.

**Decision.** A single, atomic, org-scoped conditional `updateMany`, in
`packages/database/src/repositories/approval-requests.ts:41-56`:

```ts
export async function transitionApprovalRequest(
  id: string, organizationId: string,
  toStatus: Extract<ApprovalStatus, 'APPROVED' | 'REJECTED' | 'CANCELLED'>,
  approvedById?: string,
): Promise<boolean> {
  const result = await prisma.approvalRequest.updateMany({
    where: { id, organizationId, status: 'PENDING', expiresAt: { gt: new Date() } },
    data: { status: toStatus, /* ... */ },
  });
  return result.count === 1;
}
```

The `where` clause carries the entire guarantee: `id`, `organizationId`, `status: 'PENDING'`, and
`expiresAt: { gt: new Date() }` all sit in the same query as the write itself, and the write only lands
if that `where` still matches at the moment Postgres evaluates it. Two callers racing to approve the
identical plan both issue this exact `updateMany`; the database decides which write commits first — the
loser's `where` no longer matches, so its `count` comes back `0`, and `ApprovalService.approve()`
translates that into a thrown `ConflictError`. The repository's own comment states the rejected
alternative explicitly: "never a plain `findFirst` + `update` pair, which would race" — a separate
read-then-write is exactly the shape that lets two concurrent requests both observe `PENDING` before
either writes (the classic TOCTOU bug).

**Consequences.**
- No signing/verification code path to get wrong (constant-time comparison, algorithm confusion, a
  duplicate expiry claim that can drift out of sync with the database's own `expiresAt`).
- Plan-content tampering is covered by a separate, unsigned mechanism instead — `planHash`, a plain
  SHA-256 digest recomputed and compared at execution time
  (`apps/web/features/execution/services/execution.service.ts:63-65`) — because the property being
  verified there ("is `steps` byte-for-byte what it was when hashed") doesn't need a secret; only a
  server-authored value compared against itself.
- This design has a stated, explicit limit: it protects the *transition*, not the *judgment* behind it —
  any organization member whose live role satisfies `requiredRole` may approve alone; there is no
  reviewer-diversity or quorum requirement, and a compromised session gets no additional resistance from
  this gate.

See [Approvals](../security/approvals.md) for the complete mechanics, including the asymmetric
rate-limiting between `/approve` and `/reject`.

## ADR-003: One polymorphic table over N duplicated ones

**Status:** Accepted, implemented incrementally (Phase 4 through Phase 9), reused deliberately each time.

**Context.** Several subsystems need one table that logically attaches to many otherwise-unrelated
entity types: comments on Projects/Tasks/Meetings/Documents/Customers/graph nodes, version history for
Documents/Projects/Meetings/Entities, and a Domain Event log that can reference any entity for the
Activity Feed. The two options are a hard foreign key per target type (N join tables, or N nullable FK
columns on one table) versus one shared table keyed by a loosely-typed `entityType`/`entityId` pair (no
Prisma relation, no referential-integrity constraint from the DB itself). The pattern originates with
Phase 4's `Embedding` model, whose own doc comment (`schema.prisma:1019-1021`) states the reasoning
first: "Polymorphic by design (sourceType/sourceId, not a hard FK) — a single embeddings table spanning
four unrelated source tables can't use a normal Prisma relation."

**Decision.** Reuse that same `entityType`/`entityId` (or `sourceType`/`sourceId`) shape every time this
need recurs, rather than inventing a fresh join-table scheme per feature. `Comment`
(`schema.prisma:2044-2081`) states it explicitly, cross-referencing the precedent: "`entityType`/`entityId`
are loosely typed (no hard FK) — matches `Embedding.sourceType`/`sourceId`'s own established precedent
for 'one table spanning genuinely unrelated source tables can't use a normal Prisma relation.'"
`EntityVersionSnapshot` (`schema.prisma:2286-2288`) does the same for Shared Editing's version history:
"ONE polymorphic table (mirrors Event/AuditEvent's own 'one table, not N duplicated ones' precedent), not
a separate history table per Document/Project/Meeting/Entity." `Event`
(`schema.prisma:1918-1941`) uses the identical shape for its Phase 9 `entityType`/`entityId` addition,
denormalized specifically so the Activity Feed can query by entity as an indexed lookup instead of a
`payload` JSON scan.

**Consequences.**
- One table, one index shape, one cleanup path per feature, instead of N near-identical tables that
  would drift independently over time. `Comment`'s own doc comment notes the DB itself cannot enforce
  referential integrity here — deleting a target entity does **not** cascade automatically; cleanup is a
  deliberate application-level call (`deleteCommentsForEntity`, wired into every relevant delete service)
  precisely because comment threads are user-visible enough (reachable from a stale notification link) to
  need real cleanup, unlike `Embedding`'s own acknowledged, unaddressed orphan-row gap.
- This pattern is **not** universal — it's a considered choice, not a reflex. `AuditEvent`
  (`schema.prisma:1465-1481`) uses a real FK (`executionId → ToolExecution`) plus a free-text `action`
  string instead, because it isn't entity-polymorphic in the same structural sense — it's a single log
  for write-lifecycle transitions, not a table attached to many unrelated target types. `AgentTimelineEvent`
  similarly uses real FKs (`agentId`, `conversationId`, `goalId`) because it's scoped to one agent, not
  spanning multiple target-entity tables. Applying the polymorphic shape to either would have been the
  wrong call — the actual convention is "polymorphic when genuinely N-unrelated-tables, real FK when
  scoped to one."

## ADR-004: No CRDT for Shared Editing — optimistic locking instead

**Status:** Accepted, implemented (Phase 9). Explicitly scoped out at the spec level, not a shortcut
discovered later.

**Context.** Phase 9 needed to let concurrent editors of the same Document/Project/Meeting avoid
silently clobbering each other's changes. The strongest version of that problem — live, character-level
concurrent editing — is normally solved with a CRDT or operational-transform algorithm (the mechanism
behind Google Docs-style collaborative editing). BOND OS's own spec for this phase states plainly: "No
CRDT implementation required in this phase."

**Decision.** An additive `version: Int @default(1)` column on `Document`, `Project`, and `Meeting`.
Every update, inside the same transaction as the write itself, snapshots the row's pre-overwrite state
into `EntityVersionSnapshot` (see ADR-003) and increments `version` by one
(`packages/database/src/repositories/projects.ts:200-250`). A caller that wants conflict-checking reads
the row's current `version` and passes it back as `expectedVersion`; the update's `WHERE` clause then
includes `version: current.version`, and a mismatch throws `ConflictError` (409) rather than silently
overwriting. A caller that omits `expectedVersion` — every pre-Phase-9 call site — gets the identical
last-write-wins behavior it always had; the check only activates for a caller that opts in.

**Consequences.**
- No merge algorithm to implement or reason about; a version conflict is *surfaced*, not resolved — the
  client is expected to re-fetch (getting the new `version`) and show the user both their pending change
  and the current state.
- This is a genuinely additive change: the `version` column defaults every existing row to a valid state,
  and `expectedVersion`'s optionality means no existing caller's behavior changed the day this shipped.
- A real, acknowledged gap: `Task` never received a `version` column, unlike Project/Document/Meeting/
  Entity — an unexplained coverage gap in Phase 9, not a documented exclusion (see the root
  [README's Roadmap](../../README.md#roadmap)). `Entity` ("Notes") is schema-ready (`Entity.version`
  exists) but has no general edit path at all yet — there's no `updateEntity` repository function or
  PATCH route, so Shared Editing has nothing to extend there until basic Entity editing becomes a real
  feature.

See [Collaboration](../collaboration.md#shared-editing-optimistic-locking-not-crdt) for the full
mechanism.

## ADR-005: Cache-backed presence, not a database table

**Status:** Accepted, implemented (Phase 9).

**Context.** Presence — "who's viewing this page right now" — is ephemeral, written far more often than
almost anything else in this codebase (a heartbeat roughly every 15 seconds per open page, per user), and
has zero audit value: nobody needs a permanent record that a user was online at a given second. A durable
Postgres table is the default choice for most state in this codebase, but it's a poor fit here
specifically — high write volume, no query need beyond "right now," no retention requirement.

**Decision.** Presence lives exclusively in `getCache()` (`packages/shared/src/cache.ts`) — there is no
`Presence` Prisma model anywhere in the schema, on purpose. One Cache key per `(organizationId, page)`
pair (not per user, since the `Cache` interface has no prefix-scan primitive to assemble a per-page
snapshot from per-user keys), holding a small map keyed by `userId`:

```ts
function presenceCacheKey(organizationId: string, page: string): string {
  return `presence:org:${organizationId}:page:${page}`;
}
```

There is no explicit "user left the page" write either — tab close, network loss, and crashes all make
that unreliable to rely on. Instead, `getPresenceSnapshot` filters the stored map to entries whose
`lastActiveAt` is within `PRESENCE_STALE_MS` (30 seconds, roughly two missed heartbeats) of now — a user
silently drops out of every snapshot within ~30 seconds of their last heartbeat, no separate write, no
worker, no timeout job.

**Consequences.**
- Zero schema footprint, zero migration cost, and the read-modify-write heartbeat is a genuine,
  **accepted** race: two users heartbeating the same page at nearly the same instant can both read the
  map before either writes, and the second write overwrites the first's entry. This is deliberately not
  fixed with a lock or an atomic per-field Redis command — a dropped entry self-heals on that user's next
  heartbeat (~15 seconds later), a materially different risk profile from the atomic `updateMany` used
  for `ApprovalRequest`/`WorkflowRun` step claims, which protect real, once-only side effects rather than
  a dot flickering for a few seconds.
- Presence is inherently single-process-consistent-at-best without Redis: `InMemoryCache` gives
  per-instance dedup only; cross-instance presence requires `REDIS_URL` to be set. See
  [scalability.md](./scalability.md).
- No presence history — once a page's Cache key expires (`PRESENCE_KEY_TTL_SECONDS`, 120 seconds of zero
  heartbeats from anyone), that page's presence resets to empty with no record of who was there before.

See [Presence](../presence.md) for the full mechanics.

## ADR-006: Offline-generated initial migration, no live dev database

**Status:** Accepted as a build-time constraint, not a preference — documented as such rather than
presented as a deliberate stylistic choice.

**Context.** This project was built in a sandboxed environment with no live Postgres instance available
at development time. Prisma's normal `migrate dev` workflow requires a reachable database to diff
against. The schema itself grew to 67 models / 46 enums across 9 phases before it was ever applied to a
real database.

**Decision.** Generate the single initial migration offline, via `prisma migrate diff --from-empty`
(the exact, checked-in npm script `packages/database/package.json`'s `migrate:diff:init`:
`prisma migrate diff --from-empty --to-schema-datamodel=prisma/schema.prisma --script`), and validate the
schema with `prisma validate` rather than by actually running it. The result,
`packages/database/prisma/migrations/20260718000000_init/`, is the entire current schema in one
migration file. `docs/development/coding-standards.md:201-207` states this plainly: "generated offline
... because the project was built in a sandboxed environment with no live Postgres available ... There
isn't yet a multi-migration history to point to as evidence of the additive-only convention in
migration-file form."

**Consequences.**
- Running `pnpm db:migrate` for the first time against a real database is genuinely the first real
  application of this migration, not a formality — `docs/development/setup.md` calls this out directly so
  a new contributor isn't surprised if something in a 77KB single-migration SQL file needs a fix on first
  run.
- Every schema change from here forward goes through the normal, reachable-database `prisma migrate dev`
  flow — this constraint applied only to getting the project off the ground, not to its ongoing
  development model.
- The additive-only schema convention (see [design-principles.md](./design-principles.md#additive-only-schema-evolution))
  is demonstrated at the code/comment level throughout the schema, but has no multi-migration file
  history to point to yet as corroborating evidence — worth knowing before assuming migration-file
  archaeology will show it.

## ADR-007: Synchronous, in-process Event Bus — no message broker

**Status:** Accepted, implemented (Phase 8).

**Context.** Phase 8 needed a way for a domain write (e.g. marking a task `DONE`) to trigger org-authored
automation (a `WorkflowDefinition`) without the domain service itself knowing anything about workflows.
The conventional shape for "publish an event, something else reacts later" at any real scale is a message
broker or queue (Kafka, SQS, Redis Streams) with at-least-once delivery and a separate consumer process.

**Decision.** `publishEvent()` (`apps/web/features/workflows/services/event-bus.service.ts`) is a plain
`async` function call, awaited on the same call stack, same request, same process as the write that
triggered it — not a message published to a broker. It persists the `Event` row unconditionally first,
then attempts synchronous dispatch wrapped in its own `try`/`catch`, so a workflow that throws, times
out, or exhausts its budget never propagates back to the original caller; the caller only ever sees the
persisted `Event`. A `WorkflowDispatchBudget` (`WORKFLOW_MAX_SYNC_STEPS`, default 20/max 100;
`WORKFLOW_MAX_SYNC_MS`, default 5000ms/max 30000ms) bounds how much synchronous work one triggering write
can be made to do, and a cycle guard (`enterWorkflowDispatch`) refuses to start a second run of the same
`WorkflowDefinition` within one dispatch chain.

**Consequences.**
- Zero new infrastructure — no broker to deploy, operate, or reason about failure modes for.
- No at-least-once delivery and no retry-on-dispatch-failure: a workflow that throws during dispatch is
  logged and dropped for that firing, not re-queued. `docs/workflows/event-bus.md` states this without
  hedging: "No message broker, no queue, no at-least-once delivery ... There is no Kafka/SQS/Redis
  Streams equivalent anywhere in this phase."
- A triggering write's own HTTP request now shares its time budget with however many workflow steps that
  write triggers, synchronously — this is the direct scaling cost of the decision, detailed in
  [scalability.md](./scalability.md).
- The cycle guard has a known, documented limit: it only protects one synchronous dispatch chain, not
  across an `APPROVAL` gap (a resume gets a fresh, in-memory budget). The engine's own design-review
  comment in `workflow-run.service.ts` calls the `MAX_ACTIVE_RUNS_PER_DEFINITION = 5` cap "the honest,
  bounded mitigation instead" of a fully correct, DB-detectable cross-gap cycle check — see
  [system-architecture.md](./system-architecture.md#4-code--the-workflow-engine).

See [Event Bus](../workflows/event-bus.md) for the complete mechanism.

## Further reading

- [scalability.md](./scalability.md) — the concrete numbers (budgets, TTLs, poll intervals) these
  decisions produce, and what they mean for real load.
- [design-principles.md](./design-principles.md) — the recurring implementation patterns these decisions
  are built from.
- [docs/security/threat-model.md](../security/threat-model.md) — how ADR-002 composes with the rest of
  BOND OS's security posture.
