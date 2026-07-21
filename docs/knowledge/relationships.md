# Relationships

`Relationship` (`packages/database/prisma/schema.prisma`) is the knowledge graph's typed edge — one
entity pointing at another with a specific `RelationshipType` and a `confidence` score. This doc
covers the model, the full 15-value `RelationshipType` enum (which are auto-detected vs.
manual-API-only), idempotency, and permissions. See [graph.md](graph.md) for the model overview,
[extraction.md](extraction.md) for exactly how each auto-detected type gets created, and
[../graph-api.md](../graph-api.md) / [../api/graph.md](../api/graph.md) for the manual-creation
REST endpoint in full.

## The `Relationship` model

```prisma
model Relationship {
  id               String           @id @default(cuid())
  organizationId   String
  sourceEntityId   String
  targetEntityId   String
  relationshipType RelationshipType
  confidence       Float            @default(1.0)
  createdById      String?
  createdAt        DateTime         @default(now())

  @@unique([sourceEntityId, targetEntityId, relationshipType])
  @@index([organizationId])
  @@index([sourceEntityId])
  @@index([targetEntityId])
}
```

A new, parallel model rather than a retrofit of Phase 2's `EntityRelationship` — see
[graph.md](graph.md#edges-are-a-new-relationship-model-not-a-retrofit) for why. `confidence` is a
deterministic, fixed weight set once in code per detection rule — never a probability from a model —
so exact-signal detections can be visually or algorithmically distinguished from heuristic ones
without any ML.

## `RelationshipType` — 15 values

```prisma
enum RelationshipType {
  WORKS_AT OWNS CREATED MENTIONED_IN RELATED_TO PART_OF BELONGS_TO REPORTS_TO
  ATTENDED SENT RECEIVED REFERENCES DUPLICATE_OF TAGGED_WITH DEPENDS_ON
}
```

### Automatically detected (6 of 15)

`apps/web/features/graph/services/extraction-pipeline.service.ts`'s `runSmartLinkingForDocument`
detects these deterministically, from signals available at the moment a Library document is uploaded
and parsed:

| Type | Fires when | Confidence | Detection kind |
| --- | --- | --- | --- |
| `MENTIONED_IN` | Every extracted entity (person, company, website, project mention, meeting mention) → the source document's `Entity`. | `1.0` | Exact — it was literally found in this document's text. |
| `RELATED_TO` | An extracted `PROJECT` mention → the document that mentioned it. | `1.0` | Exact. |
| `PART_OF` | An extracted `MEETING` mention → the document that mentioned it (the document is treated as notes from/part of that meeting). | `1.0` | Exact. |
| `REFERENCES` | An extracted file reference (e.g. `"budget.xlsx"`) whose filename exactly matches another `KnowledgeDocument.fileName` in the org → the referenced document. | `0.8` | Exact-string match, but a name collision across two unrelated files is possible — not certainty. |
| `WORKS_AT` | A `PERSON` and a `COMPANY` extracted within `PROXIMITY_CHARS = 200` characters of each other in the same document (roughly the same paragraph). | `0.6` | Proximity heuristic. |
| `ATTENDED` | Every extracted `PERSON` in a document × every `MEETING` mention extracted from that *same* document — an unqualified all-pairs join, no proximity check. | `0.7` | Co-occurrence heuristic, and the loosest one: see "A real precision limitation" below. |

Confidence is a fixed weight per rule, not a computed probability — exact-signal detections get
`1.0`; proximity/co-occurrence heuristics get a lower fixed value so a UI can visually de-emphasize
them. The graph explorer does exactly this:
`style: { opacity: 0.4 + neighbor.confidence * 0.6 }`
(`apps/web/features/graph/components/graph-explorer.tsx`) — a `WORKS_AT` edge at `0.6` confidence
renders at 76% opacity, an `ATTENDED` edge at `0.7` renders at 82%, a certain `MENTIONED_IN` edge at
`1.0` renders fully opaque.

#### A real precision limitation: `detectAttended` has no proximity check

Unlike `WORKS_AT` (bounded to a 200-character window), `detectAttended` links **every** extracted
person to **every** extracted meeting mention in the same document, unconditionally:

```ts
// extraction-pipeline.service.ts
async function detectAttended(organizationId, userId, people, meetings) {
  for (const person of people) {
    for (const meeting of meetings) {
      await createRelationshipAndTrackTimeline(organizationId, userId, person.id, meeting.id, 'ATTENDED', 0.7);
    }
  }
}
```

A single document mentioning 5 people and 2 meetings produces all 10 person × meeting `ATTENDED`
edges, regardless of whether a given person is ever actually discussed near a given meeting in the
text. This is a genuine, checkable imprecision in the current rule (not a hypothetical) — worth
knowing before treating `ATTENDED` edges as a real attendee list. `WORKS_AT`'s proximity window
exists precisely because the same team recognized this failure mode for company/person pairs; it
just wasn't applied to `ATTENDED`.

### Manual-API-only (9 of 15)

`OWNS, CREATED, BELONGS_TO, REPORTS_TO, SENT, RECEIVED, DUPLICATE_OF, DEPENDS_ON` have no automatic
detection rule — there's no reliable deterministic signal available from a single document's parsed
text for most of them (`REPORTS_TO` would need an org-chart source; `SENT`/`RECEIVED` would need
real message-level sender/recipient extraction, which Phase 1's `Email` model has as plain strings
but the extraction pipeline doesn't cross-wire into). They're real, valid, queryable enum values,
creatable via `POST /api/graph/relationship` — just not auto-detected. The same
"architecture-only where there's no real signal yet" honesty Phase 2 used for its 7 connector stubs
(see [../connectors.md](../connectors.md)).

`TAGGED_WITH` is **never** stored as a `Relationship` row at all — Phase 2's `EntityTag` table
already *is* the tag relationship. `getNeighbors` (`packages/database/src/repositories/graph.ts`)
synthesizes `TAGGED_WITH` edges at query time from `EntityTag`, so tagging isn't duplicated into two
tables. It's counted here as one of the 15 enum values, but it will never appear as a row in
`Relationship` itself.

`DUPLICATE_OF` also has no automatic path, by design: [entity resolution](resolution.md) **merges**
matched duplicate `PERSON` entities into one entity rather than creating two entities linked by a
`DUPLICATE_OF` edge — "should resolve into one entity," per the original spec wording. The enum value
exists for a possible future manual-correction UI, not for any automatic write path today.

## Idempotency

`createRelationship` (`packages/database/src/repositories/relationships.ts`) checks the
`(sourceEntityId, targetEntityId, relationshipType)` unique constraint *before* writing, and returns
`null` on a duplicate instead of throwing:

```ts
export async function createRelationship(data: CreateRelationshipData): Promise<RelationshipEdge | null> {
  if (data.sourceEntityId === data.targetEntityId) return null;  // self-edges rejected

  const existing = await prisma.relationship.findUnique({
    where: { sourceEntityId_targetEntityId_relationshipType: { ...data } },
  });
  if (existing) return null;

  return prisma.relationship.create({ data: { ...data, confidence: data.confidence ?? 1 } });
}
```

This means the extraction pipeline re-processing a re-uploaded or duplicate document never creates
duplicate edges — and, because `createRelationshipAndTrackTimeline`
(`extraction-pipeline.service.ts`) only appends `CONNECTED` timeline events when `created` is
truthy, a no-op relationship creation never produces a duplicate timeline event either. See
[timeline.md](timeline.md#connected).

## Manual creation and permissions

`POST /api/graph/relationship` (`createRelationshipService` in
`apps/web/features/graph/services/graph.service.ts`) is the path for the 9 relationship types
automatic detection doesn't cover. It validates both `sourceEntityId` and `targetEntityId` resolve to
real entities in the caller's org before creating the edge (`NotFoundError` otherwise), requires
`ROLES.MEMBER`, and returns a `ValidationError` — not a silently-successful no-op — if the edge
already exists (the service layer treats `createRelationship`'s `null` return as a user-facing "that
relationship already exists" error, distinct from the extraction pipeline's own silent-no-op
handling of the same `null`). `DELETE /api/graph/relationship/[id]` requires `ROLES.ADMIN`, matching
the destructive-action bar every other feature in the app uses.

```prisma
// Body: { sourceEntityId, targetEntityId, relationshipType, confidence? }
// packages/shared/src/schemas/graph.ts
export const createRelationshipSchema = z.object({
  sourceEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
  relationshipType: relationshipTypeSchema,
  confidence: z.number().min(0).max(1).optional(),
});
```

## Reading relationships

- `listRelationships(entityId, organizationId)` — everything touching one entity, both directions, in
  two batched queries (not N+1). Backs the Entity Viewer.
- `listRelationshipsForEntities(entityIds, organizationId)` — everything touching *any* entity in a
  set, in one query — used by hybrid search's relationship-count signal (see
  [graph.md](graph.md#who-reads-the-graph)) and internally by BFS traversal.
- `listAllRelationships({ organizationId, page, pageSize, relationshipType? })` — paginated, org-wide,
  optionally filtered by type. Backs the Relationship Explorer page (`/graph/relationships`).

All three live in `packages/database/src/repositories/relationships.ts`, service-wrapped in
`graph.service.ts` behind `requireRole(organizationId, ROLES.MEMBER)`.

## What's deliberately not built

No relationship editing (a relationship is created once, with a fixed `confidence`, and only ever
deleted — never updated in place). No confidence recalculation as more documents are processed (a
`WORKS_AT` edge detected once at `0.6` stays at `0.6` forever, even if 10 more documents later
corroborate it). No bulk relationship import/export API. See [graph.md](graph.md) for the model
overview and [extraction.md](extraction.md) for the full detection pipeline these auto-detected types
come from.
