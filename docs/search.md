# Search

Keyword search only — **no AI, no embeddings, no semantic search**. PostgreSQL's built-in full-text
search functions, called via parameterized raw SQL.

## Why raw SQL, not a Prisma-managed column

Prisma has no first-class type for Postgres's `tsvector`. Rather than hand-editing generated
migrations to add an `Unsupported("tsvector")` column with a trigger to keep it in sync, `to_tsvector(
...)` runs **at query time** in `packages/database/src/repositories/search.ts`, using `$queryRaw`
tagged templates — Prisma auto-parameterizes every interpolated value, so this is safe against SQL
injection despite being raw SQL. The migration adds a matching `CREATE INDEX ... USING GIN
(to_tsvector(...))` expression index so the query can actually use an index instead of scanning
every row, without needing a stored generated column.

```ts
export async function searchEntities(organizationId: string, query: string, limit = 5) {
  return prisma.$queryRaw<EntitySearchResult[]>`
    SELECT e.id, e."entityType", e.title, e.description, kd.id AS "knowledgeDocumentId",
      ts_headline('english', coalesce(e.description, e.title), websearch_to_tsquery('english', ${query}), ...) AS snippet,
      ts_rank(to_tsvector('english', e.title || ' ' || coalesce(e.description, '')), websearch_to_tsquery('english', ${query}))::float AS score
    FROM entities e
    LEFT JOIN knowledge_documents kd ON kd."entityId" = e.id
    WHERE e."organizationId" = ${organizationId}
      AND to_tsvector(...) @@ websearch_to_tsquery('english', ${query})
    ORDER BY score DESC LIMIT ${limit}
  `;
}
```

`websearch_to_tsquery` (Postgres 11+) parses natural search-box input (quotes, `-exclude`, `or`)
the way users actually type, rather than requiring `tsquery`'s own operator syntax.
`searchKnowledgeDocumentContent` runs the same pattern against `KnowledgeDocument.parsedText`, so a
search can match words *inside* a document's extracted content, not just its title.

## Two search surfaces, deliberately not merged into one implementation

- **Phase 1's five sections** (Projects/Tasks/Documents/Meetings/Customers,
  `apps/web/features/search/services/search.service.ts`) use each entity's own existing `list*
  Service({search: q, ...})` — a simple `contains`/`insensitive` filter, unchanged from Phase 1.
- **Phase 2's "Library" section** (the same file, additively extended) uses `searchEntities` — real
  FTS with a ranked `score` and a highlighted `snippet`, per the spec's explicit "Return: title,
  snippet, score" for the new Search Index Foundation.

Converting the first five to real FTS would mean modifying Phase 1's repositories, which this phase
doesn't do. The two approaches coexist behind one `/api/search?q=` endpoint and one `/search` page —
users don't see the difference, they just see more result sections than Phase 1 had.

## Rendering FTS snippets safely

`ts_headline` wraps matched terms in literal `<b>...</b>` but does **not** escape the surrounding
text — which is a user-entered title/description. Rendering that string with
`dangerouslySetInnerHTML` would be a stored-XSS hole (any org member's title/description text would
render as live HTML for every other viewer). `apps/web/app/(dashboard)/search/page.tsx` instead
splits the snippet on the literal `<b>`/`</b>` delimiters and renders each segment as a plain React
child (auto-escaped) or a `<strong>` for the highlighted spans — same visual highlighting, no
injection risk.

## What's not built

No embeddings, no vector similarity, no ranking beyond Postgres's own `ts_rank`, no query
expansion/synonyms beyond what `websearch_to_tsquery` does natively, no cross-organization search
(every query is scoped by `organizationId`, same as everything else in this codebase).
