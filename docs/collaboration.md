# Realtime Collaboration Transport (Phase 9)

## Scope

`apps/web/features/collaboration/lib/realtime-channel.ts` — the one generic primitive every realtime
surface in Phase 9 is built on: Presence (docs/presence.md), and, as later steps land, Notifications,
the Activity Feed, Live Dashboards, and live comment-thread updates. This doc covers why it's SSE and
not WebSockets, how the reconnecting-poll loop works, how per-channel snapshot caching avoids a query
storm, and the deployment prerequisite this all rests on.

## Why SSE, not WebSockets

Nothing in this codebase has ever held a persistent bidirectional connection. Three existing routes
already stream one-shot progress over SSE (`/api/bond/chat`, `/api/agents/chat`,
`/api/execution/[id]/approve`) — each runs one generator to completion and closes. Phase 9 needed a
transport for continuously-live data (presence, unread counts, live comments), and the natural next step
was WebSockets — except this app's own documentation commits to dual deployment: the README states
`Deployment: Docker (multi-stage), Vercel-compatible`, and `docker-compose.yml`'s `web` service (a
persistent Node process) is gated behind `profiles: [full]`, not the default local-dev path. A real
WebSocket server is a first commitment to "this always runs as a long-lived container" that nothing
before Phase 9 has made. SSE over a bounded-duration serverless-safe connection, generalized from the
existing one-shot pattern into a reconnecting loop, works on both deployment targets without picking one.

## The reconnecting poll loop

```ts
export async function* channelStream<T>(channelKey: string, fetchSnapshot: () => Promise<T>): AsyncGenerator<ChannelStreamEvent<T>> {
  const startedAt = Date.now();
  let lastSerialized: string | null = null;
  // emits an initial snapshot, then polls every ~2.5s, emitting a new
  // snapshot only when the serialized content actually changed; after
  // STREAM_DURATION_MS emits `reconnect` and returns.
}
```

A connection opens, emits a snapshot immediately, then polls roughly every 2.5 seconds — emitting a new
`snapshot` event only when the content actually changed, so an idle channel produces no client-visible
traffic beyond the connection itself. After `STREAM_DURATION_MS` (25s — a safety margin under the
route's `maxDuration = 30`), the generator emits one final `{ type: 'reconnect' }` event and returns. The
**client** is responsible for reopening the connection on `reconnect` (or on any stream error) — the
server never assumes it can hold a connection indefinitely, so this works identically whether the
platform kills idle functions at 10 seconds or 15 minutes.

`GET /api/collaboration/stream?type=<type>&...` is the one entry point. The client sends a `type` plus
whatever minimal scoping params that type needs (e.g. `page` for `presence`) — it never sends a raw
channel key. The route resolves `type` against a small internal switch and *constructs* the real Cache
key from the caller's own authenticated `organizationId` (and, for per-user channels, their own
`userId`) — never from client-supplied values. This is what makes a channel key unable to be steered
into reading another organization's or another user's data; see the write-boundary/authorization
coverage in the Phase 9 security review for the enforcement proof.

## Per-channel snapshot caching via `Cache`, not a new table

```ts
async function dedupedSnapshot<T>(channelKey: string, fetchSnapshot: () => Promise<T>): Promise<T> {
  const cached = await getCache().get<T>(`collab:snapshot:${channelKey}`);
  if (cached !== null) return cached;
  const fresh = await fetchSnapshot();
  await getCache().set(`collab:snapshot:${channelKey}`, fresh, SNAPSHOT_CACHE_TTL_SECONDS);
  return fresh;
}
```

Every poll tick goes through `getCache()` (`packages/shared/src/cache.ts` — `InMemoryCache` by default,
`RedisCache` when `REDIS_URL` is set) with a 2-second TTL before it ever reaches Postgres. N
simultaneous viewers of the same channel (e.g. five people on the same Project page, all polling
presence) collapse to roughly one underlying query per TTL window, not N. This reuses infrastructure
that already had the exact optional-upgrade story this needed — `InMemoryCache` gives per-instance dedup
useful even alone; `RedisCache` gives cross-instance dedup once more than one server instance is
running — rather than inventing a new watermark column or in-process map. Redis pub/sub for sub-second
push latency is explicitly **not** built this phase; DB-polling-through-`Cache` is the whole mechanism,
on both Docker and Vercel.

## Deployment prerequisite: connection pooling

No Postgres connection pooler (PgBouncer, a managed Data Proxy, etc.) is configured anywhere in this
repository today. Holding a serverless invocation open for up to ~25 seconds per concurrent SSE viewer
is a materially different connection-lifetime profile than any route before Phase 9 — a route that
previously held a connection for the length of one query now potentially holds one for the length of a
poll loop. This is **not** solved in code this phase; it's called out here explicitly as an operational
prerequisite for real multi-user production deployment, the same way `docs/scheduling.md` documents the
`CRON_SECRET`/external-caller requirement for the tick endpoint rather than silently assuming it away.

## What this does NOT do

- **No WebSockets, no persistent bidirectional connection.** Every "live" surface in Phase 9 is this one
  poll-and-reconnect primitive, not a push-based transport.
- **No CRDT, no operational transform.** Shared Editing (below) uses optimistic-locking version
  conflicts, not live character-level merging.
- **No guaranteed sub-3-second latency.** The poll interval and snapshot TTL trade a small amount of
  staleness for avoiding a query storm; this is "continuously live," not "instant."
- **No cross-organization or unauthenticated channels.** Every channel key is built server-side from an
  authenticated session's own organization (and, where relevant, user id) — there is no channel type
  that accepts a caller-supplied organization or user id.

## Shared Editing: optimistic locking, not CRDT

Document, Project, and Meeting all carry an additive `version: Int @default(1)` column. Every update to
one of them — whether or not the caller opts into conflict-checking — does two things inside the same
transaction as the write itself:

1. Snapshots the row's state **before** the overwrite into `EntityVersionSnapshot` (one polymorphic
   table covering all versioned models, mirroring `Event`/`AuditEvent`'s own "one table, not N
   duplicated ones" precedent — see `packages/database/src/repositories/entity-version-snapshots.ts`).
2. Increments `version` by 1.

```ts
export async function updateDocument(id: string, organizationId: string, data: UpdateDocumentData): Promise<DocumentDetail | null> {
  const { expectedVersion, editedById, ...rest } = data;
  return prisma.$transaction(async (tx) => {
    const current = await tx.document.findFirst({ where: { id, organizationId } });
    if (!current) return null;
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new ConflictError(/* ... */);
    }
    await tx.entityVersionSnapshot.create({ data: { /* pre-overwrite snapshot of `current` */ } });
    const versionGuard = expectedVersion !== undefined ? { version: current.version } : {};
    const result = await tx.document.updateMany({ where: { id, organizationId, ...versionGuard }, data: { ...rest, version: { increment: 1 } } });
    if (result.count === 0) throw new ConflictError(/* a concurrent editor won the race */);
    // ...
  });
}
```

`expectedVersion` is an **additive, optional** field on `UpdateDocumentData`/`UpdateMeetingData`/
`UpdateProjectData` and their Zod input schemas. When a caller omits it — every pre-Phase-9 caller,
including the Tool Execution Framework's direct `updateProject`/`archive-project` calls — the `version`
predicate is never added to the update's `WHERE` clause, so the update behaves exactly as it always did:
last-write-wins, no `ConflictError` ever thrown. Only a caller that explicitly reads a row's current
`version` and passes it back as `expectedVersion` opts into the conflict check. This is what keeps the
change additive rather than a breaking behavior change for existing call sites.

A caller that gets `ConflictError` (409) is expected to re-fetch the row (getting the new `version`) and
show the user both their pending change and the current state — there is no automatic merge. This is a
deliberate scope boundary from the spec ("No CRDT implementation required in this phase"): a version
mismatch is surfaced, not resolved.

**Entity ("Notes") is schema-ready but not wired to an edit path.** `Entity.version` and
`EntityVersionSnapshot` support `entityType = 'GRAPH_NODE'`/`NOTE'` rows the same way they support
Document/Project/Meeting, but this codebase has no `updateEntity`-style repository function or PATCH
route for Entity at all as of Phase 9 — Entity rows are created (`createSimpleEntity`,
`createPersonEntity`) and have their metadata merged (`mergeEntityMetadata`), but there was never a
general "edit an entity's title/description" surface for Shared Editing to extend. Building one from
scratch is a new CRUD feature, not "add collaboration to an existing editor," so it's deliberately left
for whenever Entity editing itself becomes a real feature — at that point it can reuse this exact
mechanism with no schema changes.
