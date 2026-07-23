# Public API (Phase 11)

## Scope

The public REST API lives under `apps/web/app/api/v1/*` and lets external
integrations read an organization's BOND OS data over HTTP. Every route is
authenticated by an **API key**, authorized by **scope**, and bound to exactly
one **organization** — a key can never read another org's data.

## Authentication

Requests carry a bearer token:

```
Authorization: Bearer bond_sk_<64 hex chars>
```

Keys are minted in Settings → API keys (see `docs/api-keys.md` for the key
lifecycle). The guard chain is `apiV1Handler` in
`apps/web/features/api-keys/auth/api-auth.ts`, which:

1. resolves the key (`resolveApiKeyContext`) — rejecting missing, malformed,
   unknown, revoked, or expired keys with `401`;
2. enforces a per-key rate limit (the Phase 10 `API` scope, see
   `docs/rate-limits.md`);
3. enforces the route's required scope (`requireScope`), returning `403` when
   the key lacks it.

The resolved `ApiKeyContext` (`organizationId`, `userId`, `scopes`) is passed to
the handler, and every downstream query is filtered by `organizationId`.

## Endpoints

| Method & path | Scope | Notes |
| --- | --- | --- |
| `GET /api/v1` | any valid key | Discovery: identity, scopes, resource index |
| `GET /api/v1/projects` · `/{id}` | `projects:read` | Paginated list + detail |
| `GET /api/v1/tasks` · `/{id}` | `tasks:read` | |
| `GET /api/v1/documents` · `/{id}` | `documents:read` | |
| `GET /api/v1/customers` · `/{id}` | `customers:read` | |
| `GET /api/v1/meetings` · `/{id}` | `meetings:read` | |
| `GET /api/v1/search?q=` | `search:read` | Cross-entity metadata search |
| `GET /api/v1/graph` | `graph:read` | Knowledge-graph analytics |
| `GET /api/v1/notifications` | `notifications:read` | Personal keys only |
| `GET /api/v1/workflows` | `workflows:read` | Workflow definitions |
| `GET /api/v1/custom-objects` | `custom-objects:read` | Object definitions |
| `GET·POST /api/v1/custom-objects/{key}/records` | `custom-objects:read` / `:write` | List / create records |

List endpoints accept `?page`, `?pageSize` (max 100), `?search`, and `?sortDir`.

## Responses

Every endpoint returns the standard envelope from `apps/web/lib/api-handler.ts`:

```json
{ "success": true, "data": { "items": [ ... ], "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 } }
```

Errors:

```json
{ "success": false, "error": { "code": "FORBIDDEN", "message": "This API key is missing the required scope: tasks:read." } }
```

Status codes: `401` (auth), `403` (scope), `404` (missing/cross-org), `422`
(validation), `429` (rate limit).

## Reuse, not reimplementation

The read layer (`apps/web/features/api-v1/services/public-resources.service.ts`)
calls the **same repositories** the dashboard uses (`listProjects`, `listTasks`,
…). It does not add query logic and does not run session RBAC — authorization is
the API key's scope plus the hard `organizationId` filter. This guarantees the
public API can never surface anything the first-party app couldn't.

## Discoverability

- `GET /api/v1/openapi.json` — the OpenAPI 3.1 document
  (`apps/web/features/api-v1/openapi.ts`).
- `GET /api/v1/docs` — interactive Swagger UI. Authorize with a key and try
  requests against your own organization.

See also `docs/sdk.md` (the typed client) and `docs/graphql.md` (the read-only
GraphQL surface over the same repositories).
