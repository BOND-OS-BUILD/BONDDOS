# Timeline

Every entity in the knowledge graph gets a chronological activity feed — the `TimelineEvent` model
(`packages/database/prisma/schema.prisma`), append-only.

```prisma
enum TimelineEventType { CREATED MODIFIED UPLOADED MENTIONED CONNECTED VIEWED AI_ACTION }

model TimelineEvent {
  id, organizationId, entityId, eventType (TimelineEventType), description, metadata (Json?), createdAt
  @@index([organizationId])
  @@index([entityId, createdAt])
}
```

## What actually writes each event type

| Event type | Written when | Where |
| --- | --- | --- |
| `UPLOADED` | Once per document, at the start of `runSmartLinkingForDocument` — the document `Entity` itself gets this event. | `extraction-pipeline.service.ts` |
| `CREATED` | An extracted entity (person/company/website/project/meeting mention) is created for the first time — no matching existing entity was found. | `extraction-pipeline.service.ts` (`resolveOrCreateMany`/`resolvePeople`/`resolveOrCreateMentions`) |
| `MENTIONED` | An extracted entity resolved to an **existing** entity (a repeat mention) instead of creating a new one. | Same as above — the `existing ? 'MENTIONED' : 'CREATED'` branch |
| `CONNECTED` | A `Relationship` was actually created (not a no-op duplicate) — appended to **both** endpoints. | `createRelationshipAndTrackTimeline` in `extraction-pipeline.service.ts` |
| `VIEWED` | Not written by anything yet — reserved for a future "record a page view" feature; the Entity Viewer page is read-only and doesn't call the timeline API on load this phase. |
| `MODIFIED` | Not written by anything yet — reserved for a future manual-edit feature (there's no entity-editing UI this phase; extracted entities are only ever created, never edited). |
| `AI_ACTION` | Reserved for a future AI phase. Matches the spec's own "Future AI actions" line in the timeline requirements — deliberately unused, not a placeholder bug. |

Only 4 of the 7 enum values are actually written this phase (`UPLOADED`, `CREATED`, `MENTIONED`,
`CONNECTED`); the other 3 are documented, intentional reservations for functionality this phase
doesn't build (manual editing, page-view tracking, AI reasoning).

## Reading the timeline

- `getTimeline(entityId, { organizationId, page, pageSize })` — one entity's feed, newest first.
  Used by the Entity Viewer page (first page, 20 events, no pagination controls on that page — see
  `getEntityDetailService` in `apps/web/features/graph/services/graph.service.ts`).
- `getOrganizationTimeline({ organizationId, page, pageSize })` — every entity's events merged into
  one org-wide feed, newest first. Backs the standalone `/graph/timeline` page, which **does**
  paginate (20 per page).

Both share one `queryTimeline` helper in `packages/database/src/repositories/timeline.ts` — the
only difference between the two is whether `entityId` is included in the `where` clause.

## What's not built

No timeline event editing or deletion (append-only, matching an audit-log semantic — a timeline
that could be rewritten wouldn't be trustworthy). No real-time/streaming updates (the timeline is a
plain paginated read, refreshed on navigation, not a live feed). No per-user "mark as read" state.
