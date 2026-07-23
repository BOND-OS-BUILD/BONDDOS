# GraphQL API (Phase 11, optional)

## Scope

`apps/web/app/api/graphql/route.ts` + `apps/web/features/graphql/schema.ts`
provide an **optional, read-only** GraphQL surface over the same data as the
REST API. It exists for clients that prefer a single round-trip for several
resources; it adds no new capability.

## Security model

GraphQL reuses the REST security model exactly:

- **Auth** — the same API keys (`resolveApiKeyContext`). `POST` and `GET`
  require a valid key; requests are rate-limited per key.
- **Scopes** — every resolver calls `requireScope(context, '…')` before
  touching data, so `projects` needs `projects:read`, `search` needs
  `search:read`, and so on.
- **Org isolation** — resolvers reuse the public read services
  (`public-resources.service.ts`, `custom-objects-public.service.ts`), which are
  hard-scoped to `context.organizationId`. GraphQL can never read more than
  REST, or cross an org.

## Schema

```graphql
type Query {
  projects(page: Int, pageSize: Int, search: String): Page!
  tasks(page: Int, pageSize: Int, search: String): Page!
  documents(page: Int, pageSize: Int, search: String): Page!
  customers(page: Int, pageSize: Int, search: String): Page!
  meetings(page: Int, pageSize: Int, search: String): Page!
  search(q: String!): SearchResult!
  graphAnalytics: JSON
  customObjects: [CustomObjectSummary!]!
}
```

Domain rows are returned through a `JSON` scalar rather than duplicating every
field definition that already lives in the REST/OpenAPI layer.

## Usage

```bash
curl -X POST https://app.example.com/api/graphql \
  -H "Authorization: Bearer bond_sk_…" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ projects(pageSize: 5) { items total } }"}'
```

`GET /api/graphql` (with a key) returns the SDL for discovery. Responses use the
standard GraphQL `{ data, errors }` envelope; scope failures surface as a `403`
`FORBIDDEN` error inside `errors`.
