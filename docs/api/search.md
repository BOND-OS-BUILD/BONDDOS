# Search API

API reference for `/api/search` — the single global-search endpoint that powers the app's main
search bar. **One route, one query param, no pagination, no filters.** This is deliberately the
simplest of this codebase's three search surfaces; see the Notes section for how it differs from
the other two.

**1 route file, 1 endpoint.**

## Conventions

Same envelope and error-mapping conventions as [Tools & Execution API](./tools.md#conventions)
apply. Specific to this surface:

- Unlike almost every other list-shaped route in this codebase, the query schema here is a
  **local, inline `z.object({ q: z.string().trim().min(1) })`** defined directly in the route file
  (`apps/web/app/api/search/route.ts:7-9`), not one of the shared schemas under
  `packages/shared/src/schemas/`. There is no `pageSize`/`sort`/entity-type filter to document —
  the schema really is just `{ q }`.
- `requireActiveOrganizationId()` at the route, then `requireRole(organizationId, ROLES.MEMBER)`
  inside `searchService`.
- No `assertSameOrigin` — this is a `GET`-only route (no mutating method exists).
- No rate limiting.
- **No automated tests exist for this surface** — see [Tools & Execution API](./tools.md#conventions).

---

## `GET /api/search` — Global Search

**Method / Path**: `GET /api/search`
**File**: `apps/web/app/api/search/route.ts`
**Auth**: `requireActiveOrganizationId()` (route) → `searchService` internally calls
`requireRole(organizationId, ROLES.MEMBER)` (`apps/web/features/search/services/search.service.ts:47`).

Metadata-only search — fans out, in parallel, to each Phase 1 entity's own `list*Service` with
`{ search: q, page: 1, pageSize: 5 }`, plus one Phase 2 full-text search call, and returns the top 5
hits per category. **No AI, no embeddings, no semantic matching** — every Phase 1 category (`projects`,
`tasks`, `documents`, `meetings`, `customers`) reuses that entity's existing case-insensitive
`contains` filter (the exact same filter its own `GET /api/<entity>?search=...` list endpoint uses —
see [Company Data API](./company-data.md)); only `library` uses real PostgreSQL full-text search
(`searchEntities`, the same primitive `GET /api/graph/search` calls).

### Query params

| Field | Type | Notes |
|---|---|---|
| `q` | string | required, min 1 char after trimming |

### Example request

`GET /api/search?q=onboarding`

### Response — `200`

```ts
interface SearchResults {
  projects: ProjectListItem[];   // up to 5, newest first
  tasks: TaskListItem[];         // up to 5, newest first
  documents: DocumentListItem[]; // up to 5, newest first
  meetings: MeetingListItem[];   // up to 5, by meetingDate desc
  customers: CustomerListItem[]; // up to 5, newest first
  library: EntitySearchResult[]; // up to 5, full-text ranked — Library documents, Contacts, Websites, and any future connector-sourced content
}
```

Each item shape (`ProjectListItem`, `TaskListItem`, etc.) is identical to that entity's own list
endpoint — see [Company Data API](./company-data.md) for the full field breakdown of each. `library`
items use `EntitySearchResult`: `{ id, entityType, title, description, knowledgeDocumentId, snippet, score }`
(see [Graph API](./graph.md)/[AI & Retrieval API](./ai.md) for where this shape reappears).

```json
{
  "success": true,
  "data": {
    "projects": [ { "id": "proj_11ee...", "title": "Q3 Onboarding Revamp", "status": "ACTIVE", "priority": "MEDIUM", "taskCount": 4, "documentCount": 1, "meetingCount": 2, "memberCount": 3, "owner": null, "description": null, "startDate": null, "dueDate": null, "createdAt": "2026-06-01T09:00:00.000Z", "updatedAt": "2026-07-15T09:00:00.000Z" } ],
    "tasks": [],
    "documents": [],
    "meetings": [],
    "customers": [],
    "library": [ { "id": "ent_2f3a...", "entityType": "DOCUMENT", "title": "Onboarding Checklist", "description": null, "knowledgeDocumentId": "kdoc_2f3a...", "snippet": "…employee <b>onboarding</b> checklist covers…", "score": 0.61 } ]
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Not a member of the active org. |
| 422 | `VALIDATION_ERROR` | Empty `q`. |

### Notes

- **Three distinct search surfaces exist in this codebase — do not conflate them:**
  1. **`GET /api/search`** (this file) — plain `contains`/full-text, fixed top-5-per-type, no
     filters, no pagination. The main search bar.
  2. **`GET /api/graph/search`** (see [Graph API](./graph.md)) — the same full-text primitive plus
     relationships and timeline events, which this endpoint intentionally doesn't cover.
  3. **`GET /api/retrieval/search`** (see [AI & Retrieval API](./ai.md)) — real hybrid
     text+semantic vector search with relationship/recency scoring, the primitive Mr. Bond's RAG
     pipeline uses. The only one of the three that calls an embedding provider.
- Every result category runs through its entity's own service (`listProjectsService`,
  `listTasksService`, etc.), so this endpoint inherits those services' own org-scoping and
  `MEMBER`-role checks — `searchService`'s own top-level `requireRole` call is somewhat redundant
  with those, but is what's actually checked first.
- `RESULTS_PER_TYPE` (5) is a hardcoded constant, not a query param — there is no way to ask this
  endpoint for more than 5 results per category; a caller who needs full-precision results for one
  category should call that category's own list endpoint directly with `?search=...`.

## Related docs

- [Company Data API](./company-data.md) — the six `list*Service` calls this endpoint fans out to,
  and every result item's full field shape.
- [Graph API](./graph.md) — `GET /api/graph/search`, this endpoint's relationships/timeline-aware
  sibling.
- [AI & Retrieval API](./ai.md) — `GET /api/retrieval/search`, this endpoint's semantic sibling.
