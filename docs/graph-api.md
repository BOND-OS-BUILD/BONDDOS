# Graph API

All routes live under `/api/graph/*`, follow the same pattern as every other route in the app
(`apiHandler(...)` wrapping, `assertSameOrigin` on every mutation, `requireActiveOrganizationId()`,
`parseJsonBody`/`parseQueryParams` with a Zod schema from `@bond-os/shared`), and return the
standard envelope: `{ success: true, data }` or `{ success: false, error: { code, message,
details? } }`. Every handler requires `ROLES.MEMBER` at minimum (enforced in the service layer, not
the route); delete operations require `ROLES.ADMIN`.

| Method | Path | Purpose | Service |
| --- | --- | --- | --- |
| `GET` | `/api/graph` | Analytics/overview — dashboard cards for `/graph`. | `getGraphAnalyticsService` |
| `GET` | `/api/graph/node?type=&id=` | Light, visualization-oriented: one node + its immediate neighbors in one round trip. Used by React Flow's expand-on-click. | `getNodeService` + `getNeighborsService` |
| `GET` | `/api/graph/entity/[id]` | Full detail: the entity + every relationship (outgoing/incoming) + the first page of its timeline. Backs the Entity Viewer page. | `getEntityDetailService` |
| `GET` | `/api/graph/entity/[id]/connected?maxDepth=` | Every entity reachable within `maxDepth` hops (default 3, max 6) — bounded BFS. | `findConnectedEntitiesService` |
| `GET` | `/api/graph/search?q=` | Graph-specific search: entities (reusing Phase 2's FTS) + relationships + timeline events — broader than the main `/api/search`, which only covers entities. | `searchGraphService` |
| `GET` | `/api/graph/path?from=&to=` | Shortest path between two entities (bounded BFS, returns `{ path: string[] }`, 404 if none found within the depth cap). | `findShortestPathService` |
| `GET` | `/api/graph/timeline?entityId=&page=&pageSize=` | One entity's timeline (`entityId` set) or the org-wide feed (`entityId` omitted). | `getTimelineService` / `getOrganizationTimelineService` |
| `GET` | `/api/graph/relationship?page=&pageSize=&relationshipType=` | Paginated, org-wide, optionally filtered by type. Backs the Relationship Explorer page. | `listRelationshipsService` |
| `POST` | `/api/graph/relationship` | Manual relationship creation — the path for the 10 relationship types automatic detection doesn't cover (see docs/relationships.md). Body: `{ sourceEntityId, targetEntityId, relationshipType, confidence? }`. | `createRelationshipService` |
| `DELETE` | `/api/graph/relationship/[id]` | Requires `ROLES.ADMIN`. | `deleteRelationshipService` |

## Why `/node` and `/entity/[id]` are two different endpoints

They serve different callers with different weight requirements:

- **`/node`** is called on every click while exploring the graph canvas — it needs to be cheap and
  return just enough to render a new node + its edges (`{ node, neighbors }`).
- **`/entity/[id]`** is called once, when a user navigates to a dedicated Entity Viewer page — it
  can afford to eagerly return the full relationship list (both directions) and a page of timeline,
  since it's not called on every interaction.

## Query schemas

All defined in `packages/shared/src/schemas/graph.ts`, following the exact `.extend()`-off-
`paginationQuerySchema` pattern every other entity's query schema already uses:
`relationshipQuerySchema`, `timelineQuerySchema`, `nodeQuerySchema`, `pathQuerySchema`,
`graphSearchQuerySchema`, `connectedEntitiesQuerySchema`, plus `createRelationshipSchema` for the
`POST` body and the `RELATIONSHIP_TYPES`/`GRAPH_NODE_TYPES` literal arrays their enums are built
from (duplicated from the Prisma enums by convention — `packages/shared` never imports
`@bond-os/database`'s generated types, keeping the two packages independent; see any other schema
file, e.g. `packages/shared/src/schemas/document.ts`, for the same pattern).

## Response shapes

Every list endpoint returns the same `PaginatedResult<T>` shape Phase 1 established:
`{ items, page, pageSize, total, totalPages }`. `GraphNode`, `RelationshipEdge`,
`TimelineEventItem`, `NeighborEdge`, `ConnectedEntity`, and `GraphAnalytics` are all exported from
`@bond-os/database` (`packages/database/src/repositories/{graph,relationships,timeline}.ts`) —
import the types directly rather than re-declaring them when building a new client of this API from
within the monorepo. From a **client component**, don't import from `@/features/graph/services/*`
(server-only) — either declare a local matching interface (see
`apps/web/app/(dashboard)/graph/search/page.tsx` for the pattern) or `import type` from
`@bond-os/database` directly, which has no server-only guard.
