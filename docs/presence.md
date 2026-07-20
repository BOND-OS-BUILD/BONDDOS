# Presence (Phase 9)

## Scope

`apps/web/features/collaboration/services/presence.service.ts` plus the `POST /api/presence` heartbeat
route and the `presence` channel type on `GET /api/collaboration/stream` (docs/collaboration.md). This
doc covers why presence lives in `Cache` instead of Postgres, the heartbeat/staleness mechanics, and the
accepted concurrency trade-off in the read-modify-write update.

## Why `Cache`, not a table

Presence is ephemeral, written far more often than almost anything else in this codebase (a heartbeat
every ~15 seconds per open page, per user), and has zero audit value — nobody needs a permanent record
that a user was "online" at a given second. That's an intentional mismatch with a durable Postgres
table, which is why presence uses `getCache()` (`packages/shared/src/cache.ts`) exclusively. There is no
`Presence` Prisma model anywhere in the Phase 9 schema, on purpose.

## One Cache key per (organization, page), not per user

```ts
function presenceCacheKey(organizationId: string, page: string): string {
  return `presence:org:${organizationId}:page:${page}`;
}
```

The `Cache` interface (`get`/`set`/`del`/`has`) has no prefix-scan primitive — there is no way to ask it
"give me every key matching `presence:org:X:*`". A one-key-per-user design would have no way to assemble
a snapshot of "everyone currently on this page" without exactly that scan. Instead, each (organization,
page) pair maps to a single Cache key whose value is a small map keyed by `userId`, and a heartbeat does
a read-modify-write against that one key:

```ts
export async function recordPresenceHeartbeat(input: RecordPresenceHeartbeatInput): Promise<void> {
  const existing = (await cache.get<PresenceMap>(key)) ?? {};
  // prune anything already stale, then set this user's fresh entry
  const next: PresenceMap = { ...pruned, [input.user.id]: { user, status, entityId, cursor, lastActiveAt: now } };
  await cache.set(key, next, PRESENCE_KEY_TTL_SECONDS);
}
```

## No explicit "offline" write — staleness does the work

A heartbeat only ever records "this user was active at this moment." There is no corresponding "user
left the page" event the client is expected to fire (tab close, network loss, and crashes all make that
unreliable anyway). Instead, `getPresenceSnapshot` filters the stored map to entries whose
`lastActiveAt` is within `PRESENCE_STALE_MS` (30 seconds — roughly two missed heartbeats at the client's
~15-second interval) of now:

```ts
const viewers = Object.values(existing).filter((entry) => now - entry.lastActiveAt < PRESENCE_STALE_MS);
```

A user reads as present exactly as long as their heartbeats keep landing, and silently drops out of
every snapshot within ~30 seconds of their last one — no separate write, no worker, no timeout job.

## Accepted race: concurrent heartbeats can drop each other's write

The read-modify-write above is not atomic. Two users heartbeating the same page at nearly the same
instant can both read the map before either writes, and the second write overwrites the first's entry —
a genuine lost update, not a hypothetical one. This is deliberately **not** fixed with a lock or an
atomic per-field Redis command. Presence has already been established as ephemeral and zero-audit-value;
a dropped entry self-heals on that user's *next* heartbeat, at most ~15 seconds later. This is a
materially different risk profile from the atomic `updateMany` claims this codebase uses for actual
state transitions (`ApprovalRequest`, `WorkflowRun` step claims) — those protect real, once-only side
effects; a presence dot flickering for a few seconds protects nothing.

## Status values

`online` / `idle` / `busy` (`PresenceStatus`, `packages/shared/src/schemas/collaboration.ts`) are
reported by the client, not inferred server-side — there is no server-side idle-detection timer. A
client is expected to send `idle` once the user has stopped interacting for a while and `online` again
on the next interaction; the server trusts whatever status the most recent heartbeat carried. "Offline"
is never a stored status value — it's the absence of any fresh-enough entry, per the staleness rule
above.

## What this does NOT do

- **No cursor broadcasting beyond the poll interval.** A cursor position is carried on the heartbeat and
  surfaced on the next snapshot poll (up to ~2.5s later, per docs/collaboration.md), not pushed
  instantly — this is presence-grade freshness, not a live multiplayer cursor.
- **No presence history.** Once a page's Cache key expires (`PRESENCE_KEY_TTL_SECONDS`, 120s of zero
  heartbeats from anyone), that page's presence simply resets to empty — there's no record of who was
  there before.
- **No cross-organization presence.** The Cache key is always namespaced by the caller's own
  `organizationId`, resolved server-side from the session — never a client-supplied value.
