# Organization Analytics

Per-organization analytics (Phase 10) live at `/analytics` and are available to organization **ADMIN** and **OWNER** roles. Everything aggregates existing operational data — there is **no duplicated analytics storage**.

## Tabs

- **Usage** — tool executions, workflow executions, notifications, embeddings (derived counts).
- **AI** — AI tokens (prompt + completion from assistant messages), metered API calls, storage.
- **Search** — total queries, zero-result rate, average latency, top queries, top zero-result queries.

The page is a Server Component (`app/(dashboard)/analytics/page.tsx`) that calls the services directly; the `AnalyticsTabs` client component renders the tabs and charts.

## Data sources (all reused)

| Metric | Source |
| --- | --- |
| AI tokens | `Message.tokenUsage` (assistant rows) via `getAiTokenTotal` |
| Embeddings | `EmbeddingJob` (SUCCEEDED) |
| Tool executions | `ToolExecution` |
| Workflow executions | `WorkflowRun` |
| Notifications | `Notification` |
| Search queries / zero-results / latency | `SearchQueryLog` (see below) |
| Storage / API calls | `UsageEvent` (see [monitoring.md](monitoring.md) → metering) |

## Search analytics

There was no search-query source before Phase 10. The full-text search service (`searchService`) and the RAG retrieval service (`retrieve`) now record each query into `SearchQueryLog` — query text, source (`FULL_TEXT` / `RETRIEVAL`), result count, zero-result flag, latency, and citation count — via `recordSearchQuerySafe` (best-effort; a failed analytics write never blocks the search). Aggregation is `getSearchAnalytics`.

## Charts

Charts are dependency-free, theme-aware primitives in `@bond-os/ui` (`BarChart`, `HBarList`) plus `StatCard` — no charting library was added. See `packages/ui/src/components/charts.tsx`.

## Admin-level analytics

Platform-wide AI usage, security, and health roll-ups are in the [Admin Console](admin.md) overview and its Security / Health views.
