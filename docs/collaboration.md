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
- **No CRDT, no operational transform.** Shared Editing (docs/collaboration.md's sibling coverage in the
  Comments/Spaces docs) uses optimistic-locking version conflicts, not live character-level merging.
- **No guaranteed sub-3-second latency.** The poll interval and snapshot TTL trade a small amount of
  staleness for avoiding a query storm; this is "continuously live," not "instant."
- **No cross-organization or unauthenticated channels.** Every channel key is built server-side from an
  authenticated session's own organization (and, where relevant, user id) — there is no channel type
  that accepts a caller-supplied organization or user id.
