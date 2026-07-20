# Knowledge Graph (Phase 3)

## Scope

Phase 3 builds the deterministic graph future AI features will reason over: graph nodes/edges,
rule-based entity extraction from document text, deterministic duplicate resolution, automatic
relationship detection, a per-entity activity timeline, bounded graph-query algorithms (shortest
path, connected entities), a REST API, and an interactive React Flow visualization. **No AI**: no
LLMs, no embeddings, no chat — every extraction/resolution/detection rule is regex, a dictionary,
or a heuristic (see docs/entity-resolution.md and docs/relationships.md for exactly which).
Phase 0/1/2 are unmodified except for the additive touches documented below.

## Nodes reuse `Entity`, not a new table

Phase 2 already built almost exactly what a graph node needs:

```prisma
model Entity {
  id, organizationId, creatorId, entityType, title, description, metadata (Json?),
  createdAt, updatedAt
}
```

That's an exact field match for the spec's node shape. Rather than duplicate it, Phase 3 extends
the existing `EntityType` enum with 6 new values: `PERSON, COMPANY, PROJECT, TASK, PRODUCT, EVENT`.
Combined with the 8 that already existed (`DOCUMENT MEETING NOTE CUSTOMER EMAIL CONTACT WEBSITE
FILE`), `Entity.entityType` now covers 12 of the spec's 14 node types. The remaining 2 — `Folder`
and `Tag` — are already their own Phase 2 tables and are exposed **read-only** through the graph's
node resolver (`getNode('FOLDER', id, ...)` / `getNode('TAG', id, ...)` in
`packages/database/src/repositories/graph.ts`) rather than duplicated as `Entity` rows.

A few deliberate reuse decisions:

- **`PERSON` vs `CONTACT`** — kept as two distinct enum values, not collapsed. `CONTACT` is Phase
  2's manually-added contact; `PERSON` is what the extraction engine creates automatically. Both
  point at the same `Contact` detail table (`name`/`email`/`phone`/`company`/`jobTitle`) — the same
  "two entity types, one detail table" reasoning `KnowledgeDocument` already uses for `DOCUMENT`/
  `FILE`.
- **`COMPANY`/`PRODUCT`/`EVENT`** — no dedicated detail table. `Entity.title` + the existing
  `metadata Json?` column is enough; building a table with no populated columns beyond what
  `Entity` already has would be speculative.
- **`PROJECT`/`TASK`** — as `Entity` rows, these represent **mentions extracted from document
  text** ("the document says 'Project Phoenix'"), not Phase 1's real `Project`/`Task` tables (which
  are completely untouched). See "Soft-linking" below for how the two connect.

## Edges: a new `Relationship` model, `EntityRelationship` untouched

Phase 2's `EntityRelationship` (`sourceEntityId`/`targetEntityId`/`relationType: String`/
`createdAt`) is close to what an edge needs, but the spec's edge shape adds two fields it doesn't
have — `confidence` and `createdBy` — and wants a typed enum instead of a free-form string.
Changing `relationType` from `String` to an enum would be a genuine type-level modification to an
existing column, not purely additive. Rather than touch it, Phase 3 adds a **new, parallel** model:

```prisma
enum RelationshipType {
  WORKS_AT OWNS CREATED MENTIONED_IN RELATED_TO PART_OF BELONGS_TO REPORTS_TO
  ATTENDED SENT RECEIVED REFERENCES DUPLICATE_OF TAGGED_WITH DEPENDS_ON
}

model Relationship {
  id, organizationId, sourceEntityId, targetEntityId, relationshipType (RelationshipType),
  confidence (Float @default(1.0)), createdById (String?), createdAt
  @@unique([sourceEntityId, targetEntityId, relationshipType])
}
```

`EntityRelationship` is left exactly as Phase 2 shipped it — confirmed unused (no API/UI ever calls
`createEntityRelationship`), so nothing regresses either way. This mirrors the `Document`/
`KnowledgeDocument` naming-collision resolution from Phase 2's own docs (docs/data-layer.md): when
a new phase's ideal name collides with an existing phase's model, the new phase gets a new name.

See docs/relationships.md for which relationship types are auto-detected vs. manual-API-only.

## Unavoidable additive touches to existing models

Prisma requires the inverse side of every relation to be declared. Adding `Relationship`/
`TimelineEvent` therefore required new (additive-only) fields on `Entity`, `Organization`, and
`User` — new lines added, nothing existing changed or removed, the same class of touch Phase 1 made
to `Organization` and Phase 2 made to `User`/`Entity` themselves:

- `Entity`: + `outgoingGraphRelationships`, `incomingGraphRelationships` (`Relationship[]`), +
  `timelineEvents` (`TimelineEvent[]`)
- `Organization`: + `relationships` (`Relationship[]`), + `timelineEvents` (`TimelineEvent[]`)
- `User`: + `createdRelationships` (`Relationship[]`)

## One additive hook into Phase 2's upload pipeline

The spec requires uploading a document to *automatically* create graph nodes ("Smart Linking...
everything happens automatically"). `apps/web/features/library/services/library.service.ts`'s
private `parseAndChunk()` gets one new call, inside the existing `try` block, right after
`replaceChunks` succeeds:

```ts
try {
  await runSmartLinkingForDocument({ documentEntityId: entityId, organizationId, userId, text: result.text });
} catch (error) {
  log.error('Smart linking failed', { id, message: ... }); // never fatal to the upload
}
```

This is the same class of change Phase 2 made to Phase 1's `search.service.ts` — a new
side-effecting call added to an existing function, wrapped so failure never breaks existing
behavior, no change to the function's signature or return value for any external caller.

## Soft-linking extracted mentions to real Phase 1 records

When extraction finds a `PROJECT`/`MEETING` mention whose title exactly matches a real Phase 1
`Project`/`Meeting` in the same org, the resolver stores a soft reference in the extracted entity's
`metadata` JSON — `{ linkedRecordType: 'PROJECT' | 'MEETING', linkedRecordId }` — so the Entity
Viewer page can link out to the real record. No FK, no schema coupling: Phase 1's tables are never
touched or referenced by a foreign key from the graph schema, only by an opaque id stored in JSON
that the UI resolves at render time (`apps/web/features/graph/lib/node-style.ts` /
`apps/web/app/(dashboard)/graph/entity/[id]/page.tsx`).

## Layering

Same Repository → Service → API → UI shape every prior phase established:

- **Repository** (`packages/database/src/repositories/{graph,graph-nodes,relationships,
  timeline}.ts`) — pure Prisma data access, bounded BFS for path/connected-entities queries, batched
  (`findMany({ where: { OR: [...] } })`) neighbor loading — never N+1.
- **Service** (`apps/web/features/graph/services/{resolution,extraction-pipeline,graph}.service.ts`)
  — `resolution.service.ts` (deterministic name matching, docs/entity-resolution.md),
  `extraction-pipeline.service.ts` (`runSmartLinkingForDocument` — the orchestrator wired into
  upload), `graph.service.ts` (permission-wrapped query/CRUD used by the API).
- **API** (`apps/web/app/api/graph/*`) — same `apiHandler`/`assertSameOrigin`/
  `requireActiveOrganizationId`/`parseJsonBody`/`parseQueryParams` pattern as every existing route.
  See docs/graph-api.md.
- **UI** (`apps/web/app/(dashboard)/graph/*`, `apps/web/features/graph/components/*`) — the main
  graph visualization (React Flow), Entity Viewer, Relationship Explorer, Timeline, Graph Search.

## Extraction engine (`@bond-os/extraction`)

A new, pure (no DB, no network) workspace package: regex/dictionary/heuristic candidate extraction
— emails, phone numbers, URLs, dates, file references, person names, company names, and project/
meeting mentions, each with a character offset (used for proximity-based relationship detection,
e.g. a person and company mentioned in the same paragraph). Mirrors `@bond-os/parsers`' "pure
input → output" shape. Imprecision (missed or over-matched names/companies) is expected and
explicitly acceptable per the spec ("rule-based... no AI") — documented plainly, not hidden.

## Performance

- Indexes: `Relationship` on `organizationId`/`sourceEntityId`/`targetEntityId`; `TimelineEvent` on
  `organizationId` and `(entityId, createdAt)`.
- `getNeighbors`/`getGraphAnalytics` results are cached briefly (30s) via the **existing** `Cache`
  interface (`packages/shared/src/cache.ts`, unmodified — just a new consumer).
- The `/graph` page lazily loads only the top-connected/recently-added entities initially; the rest
  loads on expand-click (`/api/graph/node`), never the whole graph at once.
- `findShortestPath`/`findConnectedEntities` are bounded, level-by-level BFS — one batched query per
  level, capped depth (6) and visited-node count (500/200) so a large graph can't make either query
  unbounded.

## What's deliberately not built

No AI, LLMs, embeddings, chat, agents, recommendations, semantic search, or memory reasoning — only
deterministic logic. No custom canvas — the visualization is React Flow (`@xyflow/react`), per the
spec's explicit instruction. Automatic entity extraction runs on Library document uploads only this
phase (not on Phase 1 Emails/Meetings directly) — a documented scoping decision, not an oversight;
see docs/relationships.md for the exact list of what automatic detection does and doesn't cover.
