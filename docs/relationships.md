# Relationships

The `Relationship` model (`packages/database/prisma/schema.prisma`) is the knowledge graph's typed
edge — see docs/knowledge-graph.md for why it's a new model rather than a retrofit of Phase 2's
`EntityRelationship`. This doc covers the 15 `RelationshipType` values: which ones the extraction
pipeline detects automatically, and which are manual-API-only.

## Automatically detected (5 of 15)

`apps/web/features/graph/services/extraction-pipeline.service.ts`'s `runSmartLinkingForDocument`
detects these deterministically, from signals actually available when a Library document is
uploaded and parsed:

| Type | When it fires | Confidence |
| --- | --- | --- |
| `MENTIONED_IN` | Every extracted entity (person/company/website/project/meeting mention) → the source document's `Entity`. | 1.0 — certain, it was literally found in that document's text. |
| `RELATED_TO` | An extracted `PROJECT` mention → the document that mentioned it. Matches the spec's own example ("Document references project → RELATED_TO"). | 1.0 |
| `PART_OF` | An extracted `MEETING` mention → the document that mentioned it (the document is treated as notes from/part of that meeting). | 1.0 |
| `ATTENDED` | Every extracted `PERSON` in a document → every `MEETING` mention extracted from that *same* document. A co-occurrence heuristic, not a real attendee list. | 0.7 |
| `WORKS_AT` | A `PERSON` and `COMPANY` extracted within ~200 characters of each other in the same document (roughly the same paragraph). A proximity heuristic. | 0.6 |

One additional, narrower detection: an extracted **file reference** (e.g. `"budget.xlsx"`) whose
filename exactly matches another `KnowledgeDocument.fileName` in the org produces a `REFERENCES`
relationship (document → the referenced document), confidence 0.8.

Confidence isn't a probability from a model — it's a fixed, deterministic weight per detection
rule, set once in code. Exact-signal detections (something was literally extracted from this exact
document) get 1.0; proximity/co-occurrence heuristics get a lower fixed value so a UI can visually
de-emphasize them if it wants to (`GraphCanvas` renders edges at `0.4 + confidence * 0.6` opacity).

## Manual-API-only (10 of 15)

`OWNS, CREATED, BELONGS_TO, REPORTS_TO, SENT, RECEIVED, DUPLICATE_OF, DEPENDS_ON` have no automatic
detection rule this phase — there's no reliable deterministic signal available from a single
document's parsed text for most of them (e.g. `REPORTS_TO` would need an org chart source, `SENT`/
`RECEIVED` would need real message-level sender/recipient extraction, which Phase 1's `Email` model
has as plain strings but this phase doesn't cross-wire into extraction). They're real, valid,
queryable enum values — creatable via `POST /api/graph/relationship` — just not auto-detected.
This is the same "architecture-only where there's no real signal yet" honesty Phase 2 used for its
7 connector stubs (docs/connectors.md).

`TAGGED_WITH` is intentionally never stored as a `Relationship` row at all — Phase 2's `EntityTag`
table already *is* the tag relationship. `getNeighbors` (`packages/database/src/repositories/
graph.ts`) synthesizes `TAGGED_WITH` edges at query time from `EntityTag`, so tagging isn't
duplicated into two tables.

`DUPLICATE_OF` also has no automatic path by design: entity resolution (docs/entity-resolution.md)
**merges** matched duplicates into one entity rather than keeping two entities linked by a
`DUPLICATE_OF` edge — "should resolve into one entity," per the spec's own wording. The enum value
exists for a future manual-correction UI, not for automatic writes.

## Idempotency

`createRelationship` (`packages/database/src/repositories/relationships.ts`) checks the
`(sourceEntityId, targetEntityId, relationshipType)` unique constraint before writing and returns
`null` on a duplicate instead of throwing — the extraction pipeline re-processing a re-uploaded or
similar document won't create duplicate edges or duplicate `CONNECTED` timeline events (which only
get appended when a relationship was actually newly created, not on a no-op).

## Manual creation and permissions

`POST /api/graph/relationship` (`createRelationshipService` in
`apps/web/features/graph/services/graph.service.ts`) validates both entities exist in the caller's
org before creating the edge, requires `ROLES.MEMBER`. `DELETE /api/graph/relationship/[id]`
requires `ROLES.ADMIN` — matches the destructive-action role bar every other feature uses.
