# Organization Activity Feed (Phase 9)

## Scope

`apps/web/features/activity/services/activity.service.ts` — a thin read view over the Event Bus's
existing `Event` table (docs/event-bus.md), not a new table. This doc covers what it filters by, what it
deliberately can't, and how it differs from the Phase 8 Workflow Event Monitor that reads the same table.

## One table, two read surfaces

`Event` already backed Phase 8's Workflow Event Monitor (`GET /api/workflows/events`) before this phase.
The Activity Feed (`GET /api/activity`) is a second, org-wide read over the same append-only table — not
a duplicate model, not a denormalized copy. The two differ only in framing and default filters: the
Event Monitor is workflow-operator-facing (built for debugging trigger/dispatch behavior); the Activity
Feed is a general "what's been happening in this organization" surface any member can read.

## Filters: event type, entity, date range — not by user

```ts
export const activityFeedQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  eventType: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});
```

`entityType`/`entityId` filtering is real and indexed (`@@index([organizationId, entityType, entityId,
createdAt])`, added in this same phase — see docs/event-bus.md's own note on why `Event` didn't have this
before). `since`/`until` filter `createdAt` directly, added additively to `listEvents`'s existing filter
set this phase.

**There is no filter by user/actor**, even though the spec lists "filterable by user" — `Event` has no
`userId` or actor column today. Every curated `publishEvent()` call site persists *what* happened, not
*who* did it; retrofitting an actor column onto `Event` and threading caller identity through every one
of the ~15 curated call sites (docs/event-bus.md's own table) is real, non-trivial surface area beyond
this phase's additive scope. This is a documented gap, not a silent one — if per-actor filtering becomes
a real requirement, the `Event` model change is additive (a new nullable column) and each call site's
`publishEvent()` call needs one more field, following the exact pattern `entityType`/`entityId` itself
just established.

## What this does NOT do

- **No filter by user/actor.** See above.
- **No new table.** This is a read view over `Event`, sharing its exact indexing and retention with the
  Event Bus and the Workflow Event Monitor.
- **No real-time push by default in the HTTP response** — live updates come from subscribing to the
  `activity` channel on `GET /api/collaboration/stream` (docs/collaboration.md), which polls this same
  service underneath.
