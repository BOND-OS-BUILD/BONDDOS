# Graph API

API reference for `/api/graph/**` — Phase 3's Universal Entity System and Knowledge Graph. Every
Phase 1 record (`Customer`, `Project`, `Task`, `Meeting`) plus Phase 2's `KnowledgeDocument`/`Folder`/
`Tag` and Phase 3's own extraction output (`PERSON`, `COMPANY`, `PRODUCT`, `EVENT`, soft-linked
`PROJECT`/`TASK`/`MEETING` mentions) are addressable as graph nodes; `Relationship` rows are the
typed edges between them. All graph traversal here is plain Prisma + in-process BFS — **no external
graph database, no AI** in this file's read paths. See [Knowledge Graph](../knowledge-graph.md),
[Relationships](../relationships.md), and [Entity Resolution](../entity-resolution.md) for the
underlying design.

**9 route files, 10 endpoints** (`GET`/`POST` both live under `/api/graph/relationship`, so it
counts as 2 endpoints from 1 file).

## Conventions

Same envelope, pagination, and error-mapping conventions as
[Tools & Execution API](./tools.md#conventions) apply throughout. Specific to this surface:

- Every route calls `requireActiveOrganizationId()`, and every service function re-checks
  `requireRole(organizationId, ROLES.MEMBER)` for reads/writes, `ROLES.ADMIN` for
  `DELETE /api/graph/relationship/[id]`.
- Mutating routes (`POST /api/graph/relationship`, `DELETE /api/graph/relationship/[id]`) call
  `assertSameOrigin(request)`.
- **Two routes cache in-process for 30 seconds**: `GET /api/graph/node` (neighbor lookups, keyed
  `graph:neighbors:{orgId}:{entityId}`) and `GET /api/graph` (analytics, keyed
  `graph:analytics:{orgId}`) — via `getCache()`. This is a single-process, in-memory cache, the same
  caveat as this codebase's in-memory rate limiter: it does not coordinate across multiple server
  instances.
- **`GRAPH_NODE_TYPES` (16 values) is broader than `EntityType`**: 12 of the 14 spec node types are
  real `Entity` rows; `FOLDER` and `TAG` are Phase 2's own standalone tables, exposed here
  read-only through the same `GraphNode` shape so the graph UI doesn't need a special case for them.
- **No rate limiting anywhere in this surface.**
- **No automated tests exist for this surface** — see [Tools & Execution API](./tools.md#conventions).

---

## `GET /api/graph` — Graph Analytics

**Method / Path**: `GET /api/graph`
**File**: `apps/web/app/api/graph/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Dashboard-card aggregates for the `/graph` page overview — plain `count`/`groupBy`/one raw
date-bucketing query, no AI. Cached in-process for 30s.

### Response — `200`

```ts
interface GraphAnalytics {
  totalEntities: number;
  totalRelationships: number;
  topConnectedNodes: Array<{ id: string; title: string; entityType: string; connectionCount: number }>; // top 10
  recentlyAdded: Array<{ id: string; title: string; entityType: string; createdAt: string }>;            // most recent 10
  relationshipTypeBreakdown: Array<{ relationshipType: string; count: number }>;
  growthOverTime: Array<{ date: string; count: number }>; // daily entity-creation counts, last 90 rows
}
```

```json
{
  "success": true,
  "data": {
    "totalEntities": 214, "totalRelationships": 187,
    "topConnectedNodes": [ { "id": "proj_11ee...", "title": "Q3 Onboarding Revamp", "entityType": "PROJECT", "connectionCount": 14 } ],
    "recentlyAdded": [ { "id": "ent_9c1a...", "title": "Jordan Lee", "entityType": "PERSON", "createdAt": "2026-07-20T09:00:00.000Z" } ],
    "relationshipTypeBreakdown": [ { "relationshipType": "MENTIONED_IN", "count": 60 }, { "relationshipType": "WORKS_AT", "count": 12 } ],
    "growthOverTime": [ { "date": "2026-07-19", "count": 4 }, { "date": "2026-07-20", "count": 7 } ]
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |

---

## `GET /api/graph/entity/[id]` — Entity Detail (Entity Viewer)

**Method / Path**: `GET /api/graph/entity/{id}`
**File**: `apps/web/app/api/graph/entity/[id]/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Full detail for the Entity Viewer page: the node itself + every relationship (both directions) +
the first page of its timeline (20 events). **Entities only** — `Folder`/`Tag` nodes go through
`GET /api/graph/node` instead, since they have no `Relationship`/`TimelineEvent` rows of their own.

### Path params

| Param | Meaning |
|---|---|
| `id` | `Entity.id` |

### Response — `200`

```ts
interface EntityDetail {
  id: string; type: string; title: string; description: string | null; metadata: unknown;
  createdAt: string; updatedAt: string;
  relationships: { outgoing: RelationshipEdge[]; incoming: RelationshipEdge[] };
  timeline: PaginatedResult<TimelineEventItem>; // page 1, pageSize 20
}
```

```json
{
  "success": true,
  "data": {
    "id": "ent_9c1a...", "type": "PERSON", "title": "Jordan Lee", "description": null, "metadata": null,
    "createdAt": "2026-07-01T09:00:00.000Z", "updatedAt": "2026-07-01T09:00:00.000Z",
    "relationships": {
      "outgoing": [ { "id": "rel_1", "relationshipType": "WORKS_AT", "confidence": 0.9, "createdAt": "2026-07-01T09:00:00.000Z", "sourceEntity": { "id": "ent_9c1a...", "title": "Jordan Lee", "entityType": "PERSON" }, "targetEntity": { "id": "ent_7b2c...", "title": "Acme Corp", "entityType": "COMPANY" } } ],
      "incoming": []
    },
    "timeline": { "items": [], "page": 1, "pageSize": 20, "total": 0, "totalPages": 1 }
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 404 | `NOT_FOUND` | No `Entity` with this `id` in this organization. |

---

## `GET /api/graph/entity/[id]/connected` — Connected Entities

**Method / Path**: `GET /api/graph/entity/{id}/connected`
**File**: `apps/web/app/api/graph/entity/[id]/connected/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Bounded BFS collecting every entity reachable from `id` within `maxDepth` hops, capped at 200 nodes
total for performance — one batched query per BFS level, not per node.

### Path params

| Param | Meaning |
|---|---|
| `id` | `Entity.id` |

### Query params — `connectedEntitiesQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `maxDepth` | number | `3` (service default) | 1-6 |

### Response — `200`

```ts
type ConnectedEntity = { id: string; title: string; entityType: string; depth: number };
```

```json
{ "success": true, "data": [ { "id": "ent_7b2c...", "title": "Acme Corp", "entityType": "COMPANY", "depth": 1 } ] }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 422 | `VALIDATION_ERROR` | `maxDepth` outside 1-6. |

### Notes

- No `404` if `id` doesn't exist — an unknown starting entity just yields an empty `[]` (BFS from a
  nonexistent node visits nothing), unlike `GET /api/graph/entity/[id]` which 404s.

---

## `GET /api/graph/node` — Node + Immediate Neighbors

**Method / Path**: `GET /api/graph/node`
**File**: `apps/web/app/api/graph/node/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Light, visualization-oriented lookup — one node plus its immediate neighborhood in a single round
trip, used by the React Flow graph UI's expand-on-click. Neighbor list includes real `Relationship`
edges in both directions **plus** the entity's `EntityTag` rows synthesized as `TAGGED_WITH` edges
(tags are not duplicated into the `Relationship` table). Neighbors are cached in-process for 30s.

### Query params — `nodeQuerySchema`

| Field | Type | Notes |
|---|---|---|
| `type` | enum | required — one of the 16 `GRAPH_NODE_TYPES` |
| `id` | string | required |

### Response — `200`

```ts
interface GraphNode { id: string; type: string; title: string; description: string | null; metadata: unknown; createdAt: string; updatedAt: string; }
interface NeighborEdge {
  relationshipId: string; relationshipType: string; confidence: number;
  direction: 'outgoing' | 'incoming'; node: { id: string; type: string; title: string };
}
```

```json
{
  "success": true,
  "data": {
    "node": { "id": "ent_9c1a...", "type": "PERSON", "title": "Jordan Lee", "description": null, "metadata": null, "createdAt": "2026-07-01T09:00:00.000Z", "updatedAt": "2026-07-01T09:00:00.000Z" },
    "neighbors": [
      { "relationshipId": "rel_1", "relationshipType": "WORKS_AT", "confidence": 0.9, "direction": "outgoing", "node": { "id": "ent_7b2c...", "type": "COMPANY", "title": "Acme Corp" } },
      { "relationshipId": "tag:et_1", "relationshipType": "TAGGED_WITH", "confidence": 1, "direction": "outgoing", "node": { "id": "tag_1a2b...", "type": "TAG", "title": "sales" } }
    ]
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 404 | `NOT_FOUND` | No node of `type` with this `id` in this organization. |
| 422 | `VALIDATION_ERROR` | Invalid `type`, or missing `id`. |

---

## `GET /api/graph/path` — Shortest Path

**Method / Path**: `GET /api/graph/path`
**File**: `apps/web/app/api/graph/path/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Bounded BFS (max depth 6, max 500 nodes visited) treating `Relationship` as undirected, one batched
query per level.

### Query params — `pathQuerySchema`

```ts
{ from: string; to: string } // both Entity.id
```

### Response — `200`

```json
{ "success": true, "data": { "path": ["ent_9c1a...", "ent_7b2c...", "ent_3d4e..."] } }
```

`path` is a flat array of `Entity.id`s from `from` to `to` inclusive. `from === to` short-circuits
to a 1-element path.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 404 | `NOT_FOUND` | No path exists between `from` and `to` within the depth/visited bounds. |
| 422 | `VALIDATION_ERROR` | Missing `from`/`to`. |

---

## `GET /api/graph/relationship` — List Relationships

**Method / Path**: `GET /api/graph/relationship`
**File**: `apps/web/app/api/graph/relationship/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Paginated, org-wide — backs the Relationship Explorer page.

### Query params — `relationshipQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `page`, `pageSize` | — | 1 / 20 | shared pagination |
| `relationshipType` | enum | — | one of the 15 `RELATIONSHIP_TYPES` (see below) |

### Response — `200`

`data: PaginatedResult<RelationshipEdge>` — see the `RelationshipEdge` shape under
`GET /api/graph/entity/[id]` above.

### Errors

Standard auth/role/validation errors.

---

## `POST /api/graph/relationship` — Create Relationship (Manual)

**Method / Path**: `POST /api/graph/relationship`
**File**: `apps/web/app/api/graph/relationship/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()` → `requireRole(organizationId, ROLES.MEMBER)`.

The manual-creation path for relationship types the automatic Smart Linking extraction pipeline
doesn't cover.

### Body — `createRelationshipSchema`

```ts
{
  sourceEntityId: string; targetEntityId: string;
  relationshipType: 'WORKS_AT' | 'OWNS' | 'CREATED' | 'MENTIONED_IN' | 'RELATED_TO' | 'PART_OF'
    | 'BELONGS_TO' | 'REPORTS_TO' | 'ATTENDED' | 'SENT' | 'RECEIVED' | 'REFERENCES'
    | 'DUPLICATE_OF' | 'TAGGED_WITH' | 'DEPENDS_ON';
  confidence?: number; // 0-1, defaults to 1 at the repository layer
}
```

### Example request

```json
{ "sourceEntityId": "ent_9c1a...", "targetEntityId": "ent_7b2c...", "relationshipType": "WORKS_AT" }
```

### Response — `201`

`data: RelationshipEdge`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or not a member. |
| 404 | `NOT_FOUND` | `sourceEntityId` or `targetEntityId` doesn't resolve in this organization. |
| 422 | `VALIDATION_ERROR` | `sourceEntityId === targetEntityId` (self-edges are rejected), or that exact `(source, target, type)` triple already exists — "That relationship already exists." |

### Notes

- Idempotent-by-construction at the repository layer: a duplicate `(source, target, type)` returns
  `null` from `createRelationship` rather than throwing a raw unique-constraint error, so the
  extraction pipeline re-detecting the same relationship on a re-parse never crashes — the service
  layer turns that `null` into the `422 VALIDATION_ERROR` above for this route's manual-create case.

---

## `DELETE /api/graph/relationship/[id]` — Delete Relationship

**Method / Path**: `DELETE /api/graph/relationship/{id}`
**File**: `apps/web/app/api/graph/relationship/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

### Response — `200`

```json
{ "success": true, "data": { "id": "rel_1" } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 404 | `NOT_FOUND` | No `Relationship` with this `id`. |

---

## `GET /api/graph/search` — Graph-Scoped Search

**Method / Path**: `GET /api/graph/search`
**File**: `apps/web/app/api/graph/search/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Entities (Phase 2 full-text search, top 10) **plus** relationships and timeline events matched by
title/description `contains` — the two result categories the main `/api/search` intentionally
doesn't cover (see [Search API](./search.md)).

### Query params — `graphSearchQuerySchema`

```ts
{ q: string } // required, min 1 char
```

### Response — `200`

```ts
interface GraphSearchResults {
  entities: EntitySearchResult[];   // up to 10, full-text ranked
  relationships: RelationshipEdge[]; // up to 10, source/target title match
  timeline: TimelineEventItem[];     // up to 10, description match
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 422 | `VALIDATION_ERROR` | Empty `q`. |

---

## `GET /api/graph/timeline` — Entity or Org-Wide Timeline

**Method / Path**: `GET /api/graph/timeline`
**File**: `apps/web/app/api/graph/timeline/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

One entity's activity feed (`entityId` set) or the org-wide feed across every entity (`entityId`
omitted) — the same `getTimeline`/`getOrganizationTimeline` primitives
`GET /api/graph/entity/[id]` and `GET /api/retrieval/context` also use internally.

### Query params — `timelineQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `entityId` | string | — | optional |
| `page` | number | `1` | |
| `pageSize` | number | `20` | max `100` |

### Response — `200`

`data: PaginatedResult<TimelineEventItem>`:

```ts
interface TimelineEventItem {
  id: string; eventType: string; description: string; metadata: unknown; createdAt: string;
  entity: { id: string; title: string; entityType: string };
}
```

```json
{
  "success": true,
  "data": {
    "items": [ { "id": "tl_1", "eventType": "AI_ACTION", "description": "Generated 6 of 6 embedding(s) via openai.", "metadata": null, "createdAt": "2026-07-20T09:00:05.000Z", "entity": { "id": "ent_9c1a...", "title": "Q3 Sales Deck", "entityType": "DOCUMENT" } } ],
    "page": 1, "pageSize": 20, "total": 1, "totalPages": 1
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 422 | `VALIDATION_ERROR` | Invalid `page`/`pageSize`. |

### Notes

- `TimelineEvent` is append-only, same convention as `AgentTimelineEvent` (see
  [Agents API](./agents.md)) — no update/delete path exists for it anywhere in this codebase.

## Related docs

- [AI & Retrieval API](./ai.md) — `GET /api/retrieval/entity` reuses this file's
  `GET /api/graph/entity/[id]` detail wholesale; `GET /api/retrieval/context`'s "connected
  entities"/"timeline events" fields come straight from `findConnectedEntities`/`getTimeline`,
  the same repository functions this file's routes call directly.
- [Search API](./search.md) — the plain-`contains` sibling of `GET /api/graph/search`.
- [Company Data API](./company-data.md) — every `Customer`/`Project`/`Task`/`Meeting` created there
  is also a graph node reachable through this file.
