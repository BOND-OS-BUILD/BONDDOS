# Scalability

An honest assessment of BOND OS's current scaling characteristics — grounded in the actual budgets,
defaults, and single-process assumptions read directly from source, not a forward-looking capacity plan.
Several of the boundaries below are stated in the code's own comments with the same bluntness used here;
this doc collects them in one place rather than softening them.

## The headline constraint: one Node process, no queue, no worker

There is no background worker or scheduler process anywhere in this codebase, confirmed repeatedly across
every phase's own documentation. Every time-based or asynchronous-seeming behavior — workflow scheduling,
`WAIT`/`DELAY` step resumption, `SyncJob`/`EmbeddingJob` retries, approval expiry — is either checked
opportunistically on the next read, or driven by one externally-triggered HTTP endpoint
(`POST /api/workflows/schedule/tick`) that an operator must wire to their own cron (Vercel Cron, GitHub
Actions, OS Task Scheduler). `packages/shared/src/queue.ts`'s `Queue` interface has exactly one
implementation, `InMemoryQueue`, which only logs an enqueue call and returns a fake job id — nothing
anywhere in this codebase consumes it. There is no Kafka/SQS/Redis Streams/BullMQ equivalent.

The `Container` diagram in [system-architecture.md](./system-architecture.md#2-container) reflects this
directly: `docker-compose.yml` defines exactly one `web` service — one Node process serves every page,
every API route, and every SSE stream. Scaling this application today means one of two things: a bigger
single instance (vertical), or more instances of the identical stateless container behind a load balancer
— and the second option is only *partially* safe, for reasons below.

## The synchronous workflow dispatch budget

A domain write that calls `publishEvent()` (see
[ADR-007](./architecture-decisions.md#adr-007-synchronous-in-process-event-bus--no-message-broker)) does
not return to its caller until every matching workflow has run to a terminal outcome or paused at
`WAITING_APPROVAL`/`WAITING_TIMER` — all inside the same HTTP request, same call stack, same process.
This is bounded by `WorkflowDispatchBudget`:

| Env var | Default | Max | What it bounds |
| --- | --- | --- | --- |
| `WORKFLOW_MAX_SYNC_STEPS` | 20 | 100 | Total synchronous steps one event's whole dispatch chain may consume, across every matched workflow |
| `WORKFLOW_MAX_SYNC_MS` | 5000 | 30000 | Wall-clock deadline for the same chain, checked at every step boundary — not just decremented, so a handful of slow steps can't quietly exceed it even while the step count is still positive |

Both throw (`WorkflowDispatchBudgetExhaustedError`) rather than silently truncating. In practice, this
means: **an ordinary user action — completing a task, uploading a document — can add up to 5 seconds of
synchronous latency to that action's own HTTP response**, if it happens to match a workflow trigger. This
is a deliberate trade-off (see ADR-007's Context), not an oversight, but it is a real ceiling on how much
automation one write can carry before the user notices their click got slower. Dispatch to multiple
matching `WorkflowDefinition`s for the same event is also strictly **sequential, not parallel** — the
budget is one shared, mutated object, and concurrent dispatch would race on its own consumption — so an
organization with many overlapping workflow triggers on one event type pays for all of them in series,
inside one request.

`MAX_ACTIVE_RUNS_PER_DEFINITION = 5` (`workflow-run.service.ts`) is a second, independent ceiling: no more
than 5 non-terminal `WorkflowRun`s may exist for the same `WorkflowDefinition` at once. Its own
design-review comment is worth quoting in full, since it documents a real, unfixed gap rather than
implying full protection:

```
/**
 * A design-review-caught gap: the dispatch budget's cycle guard
 * (visitedWorkflowDefinitionIds) only protects ONE synchronous dispatch
 * chain — it cannot see across an APPROVAL gap, since resuming after a
 * human clicks approve necessarily starts a fresh budget... A workflow
 * whose own approved write re-publishes an event matching its own trigger
 * can therefore spawn a new generation on every approval, forever, un-
 * caught by the in-memory guard alone... This is the honest, bounded
 * mitigation instead: cap concurrent non-terminal runs per
 * WorkflowDefinition, so runaway proliferation is capped, not eliminated
 * at the semantic level.
 */
```

This is the codebase's own words for it: capped, not eliminated. A fully correct fix (threading
`correlationId` through the entire plan/approval/execution chain so cross-gap cycles are DB-detectable)
is explicitly out of scope, because it would require every `*.tool.ts` to gain Phase 8 awareness — a
larger change than this phase was willing to make.

## No message queue or broker — anywhere

Worth stating plainly rather than implying: nothing in this codebase's dependency tree or runtime is a
message broker. `RedisCache` (the one real `ioredis` usage) is a cache backend only — get/set/del/exists
— never pub/sub, never a stream, never a consumer group. This means:

- **No retry-on-failure for a workflow dispatch.** A workflow that throws mid-dispatch is logged and
  dropped for that firing; there is no re-delivery.
- **No backpressure mechanism.** If publishing events faster than the synchronous dispatch budget can
  absorb them, each triggering request simply pays its own dispatch cost directly — there's no queue
  depth to monitor or buffer against a burst.
- **No cross-process work distribution.** Every dispatch happens on whichever process handled the
  triggering HTTP request; there is no way to offload workflow execution to a separate worker fleet
  without a real architectural change (introducing an actual queue and consumer).

## The SSE connection-pooling gap

Every "live" surface in this codebase (Presence, Notifications, the Activity Feed, Live Dashboards — see
[ADR-001](./architecture-decisions.md#adr-001-sse-over-websockets-for-realtime)) is a reconnecting SSE
poll loop: a connection opens, polls roughly every 2.5 seconds, and stays open for up to
`STREAM_DURATION_MS` (25 seconds) before the client is told to reconnect. `docs/collaboration.md` states
the resulting operational gap directly, and it's worth repeating rather than summarizing away:

> No Postgres connection pooler (PgBouncer, a managed Data Proxy, etc.) is configured anywhere in this
> repository today. Holding a serverless invocation open for up to ~25 seconds per concurrent SSE viewer
> is a materially different connection-lifetime profile than any route before Phase 9 — a route that
> previously held a connection for the length of one query now potentially holds one for the length of a
> poll loop. This is **not** solved in code this phase; it's called out here explicitly as an operational
> prerequisite for real multi-user production deployment.

Concretely: on a serverless deployment target (Vercel), N concurrent SSE viewers can mean N concurrent
function invocations, each potentially holding a database connection open for up to 25 seconds, not the
length of one query. Prisma's own default connection pool is small and per-process; without an external
pooler, a moderate number of simultaneous live viewers is a real, plausible way to exhaust available
Postgres connections. This is a documented, unaddressed prerequisite, not a hypothetical edge case.

Per-channel snapshot caching mitigates the *query* cost, not the *connection* cost: every poll tick goes
through `getCache()` with a 2-second TTL (`SNAPSHOT_CACHE_TTL_SECONDS`) before touching Postgres, so N
simultaneous viewers of the same channel collapse to roughly one underlying query per TTL window — **but
only when `RedisCache` is active**. With the default `InMemoryCache`, that dedup only holds within one
process; running more than one web instance without `REDIS_URL` set means each instance re-queries
independently, multiplying both query and connection load by instance count.

## `Cache`: in-memory by default, genuinely optional Redis

`packages/shared/src/cache.ts` ships two implementations behind one `getCache()` singleton:

```ts
export function getCache(): Cache {
  if (!instance) {
    const { REDIS_URL } = getEnv();
    instance = REDIS_URL ? new RedisCache(REDIS_URL) : new InMemoryCache();
  }
  return instance;
}
```

`InMemoryCache` is a plain `Map` with epoch-ms expiry checked lazily on read — no background eviction, no
cross-process visibility. This is the zero-config default, and it is what most of the codebase's caching
(SSE snapshot dedup, presence heartbeats) silently runs on unless `REDIS_URL` is explicitly set. The
practical consequence for scaling: **running more than one instance of `apps/web` without Redis
configured is not a drop-in horizontal scale-out** — it's a functional regression for every
`Cache`-backed subsystem:

- **Presence** (`presence.service.ts`) would show a different set of "currently viewing" users per
  instance, since each instance's heartbeat writes/reads only see its own `InMemoryCache`.
- **SSE snapshot dedup** loses its cross-instance benefit, as noted above.
- **Rate limiting is a separate, worse case** — `packages/shared/src/rate-limit.ts`'s `RateLimiter`
  interface has **only one implementation, `InMemoryRateLimiter`**, an in-process `Map`. Unlike `Cache`,
  there is no `RedisRateLimiter` today, even when `REDIS_URL` is set. The interface's own doc comment
  says to "swap in a Redis-backed implementation ... once running multiple instances" — that swap has not
  been built. Running multiple instances today means rate limits (including the tighter 20-req/60s limit
  on `/api/bond/chat`) are enforced **per instance**, not globally — a caller spread across N instances
  behind a load balancer effectively gets up to N times the intended limit.

## Presence: an accepted, self-healing race — not a scaling bug to fix

Worth naming explicitly as a *deliberate* boundary rather than an oversight: presence's read-modify-write
heartbeat (`recordPresenceHeartbeat`) is not atomic. Two users heartbeating the same page at nearly the
same instant can both read the stored map before either writes, and the second write drops the first's
entry — a genuine lost update. This is intentionally left unfixed with a lock or an atomic per-field Redis
command, because the entry self-heals on that user's next heartbeat (~15 seconds later) and presence has
already been established as ephemeral, zero-audit-value data. This does **not** scale worse under load —
it's a fixed, bounded, self-correcting error rate regardless of concurrent viewer count — but it is worth
distinguishing clearly from the atomic `updateMany` guarantees this codebase uses for
`ApprovalRequest`/`WorkflowRun` step claims, which protect real, once-only side effects and would not be
acceptable to leave racy in the same way.

## Database: single Postgres instance, no read replicas, no pooler

Every read and write in this application goes to the one `DATABASE_URL` Postgres instance —
`docker-compose.yml` defines a single `postgres` service with no replication configuration, and nothing
in the application code distinguishes a read-only replica connection from the primary. `pgvector`
similarity search, full-text search, every repository query, and every workflow step handler's `READ_DATA`
call all compete for the same connection pool. Combined with the SSE connection-pooling gap above, this
is the single biggest structural ceiling on this application's current concurrent-user capacity — not
because any individual query is slow, but because nothing exists yet to add read capacity or connection
headroom independently of the one Postgres instance.

## What's actually fine at today's scale

Stated plainly, since this document should not read as universally pessimistic: the design choices behind
several of the above are reasonable for the load this application is actually built for so far —
single-organization-at-a-time interactive use, not high-throughput automation. The synchronous dispatch
budget (5 seconds max) is imperceptible for a single triggering write with one or two matched workflows.
The in-memory cache/rate-limiter defaults are genuinely zero-config-correct for a single-instance
deployment, which is what `docker-compose.yml`'s non-`full`-profile default and a typical Vercel deployment
both are. Presence's accepted race is invisible in practice at the heartbeat intervals involved. None of
this is scaled to handle today; it's scaled to be simple and correct for one instance, with the seams
(the `Cache` interface, the `Queue` interface, `REDIS_URL`) already in place for the pieces that do have
a documented upgrade path.

## What does not yet have an upgrade path

- **Rate limiting** — no Redis-backed implementation exists at all; this needs to be built before running
  more than one instance behind a shared rate limit is meaningful.
- **A real message broker** — the `Queue` interface exists but has no consuming implementation; adopting
  one is a genuine new-infrastructure decision, not a config flag.
- **Postgres connection pooling** — no PgBouncer/Data Proxy is configured; this is an operational gap the
  codebase itself does not paper over.
- **Cross-gap workflow cycle detection** — bounded by a concurrency cap today (`MAX_ACTIVE_RUNS_PER_DEFINITION`),
  not solved at the semantic level; a real fix needs `correlationId` threaded through the full
  plan/approval/execution chain.

## Further reading

- [architecture-decisions.md](./architecture-decisions.md) — the reasoning behind each of the constraints
  above, as ADRs.
- [Event Bus](../workflows/event-bus.md), [Workflow Engine](../workflows/workflow-engine.md) — the full
  dispatch-budget and re-entrancy mechanics.
- [Collaboration](../collaboration.md) — the SSE transport and its stated deployment prerequisites in
  full.
- [Presence](../presence.md) — the accepted heartbeat race in full.
