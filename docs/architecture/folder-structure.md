# Folder Structure

An annotated tour of `apps/web` and `packages/*`, current as of this writing (confirmed by directly
listing both directory trees, not inferred from names). 29 feature directories under `apps/web/features/`,
10 packages under `packages/`, 50 repository files under `packages/database/src/repositories/`.

## `apps/web` — the Next.js application

```
apps/web/
├─ app/
│  ├─ (auth)/                  Public route group — login, signup, forgot/reset-password, own layout
│  ├─ (dashboard)/             Authenticated app shell — sidebar + topbar, one folder per UI surface:
│  │                           activity, agents, ai, bond, company, connectors, customers, dashboard,
│  │                           documents, execution, graph, inbox, integrations, library, meetings,
│  │                           memory, people, projects, search, settings, spaces, sync, tasks,
│  │                           team-dashboard, workflows
│  ├─ api/                     Every HTTP route, one folder per domain: activity, agents, ai, auth,
│  │                           bond, collaboration, comments, connectors, customers, documents,
│  │                           emails, embeddings, execution, graph, inbox, library, meetings,
│  │                           mentions, notifications, organization, presence, projects, retrieval,
│  │                           search, spaces, sync, tasks, tools, user, workflows, workspace
│  ├─ layout.tsx / globals.css Root layout, theme provider + toaster, design tokens
│  └─ error.tsx / not-found.tsx / global-error.tsx   Route-segment, 404, and root-failure boundaries
├─ components/                 theme-provider.tsx — the one truly app-wide shared component
├─ features/                   29 vertical-slice feature directories — see below
├─ lib/                        Single-responsibility helpers: api-handler.ts (apiHandler/apiSuccess/
│                              parseJsonBody), csrf.ts (assertSameOrigin), organization.ts
│                              (requireActiveOrganizationId), supabase.ts (uploadPublicFile),
│                              streaming-handler.ts (createSseStream)
├─ store/                      Zustand: ui-store.ts (sidebar collapsed), org-store.ts (client-side
│                              mirror of active org — never the source of truth)
├─ middleware.ts               Edge-safe route protection (session-cookie presence check only)
└─ next.config.ts / tailwind.config.ts / eslint.config.mjs / tsconfig.json / package.json
```

## `apps/web/features/*` — every feature directory, one line each

Grouped by what each one actually does (the grouping below is descriptive; every directory sits flat
under `features/` on disk).

### Company data (P1) — plain CRUD services, `requireRole` + repository, no class-based DI

| Directory | Purpose |
| --- | --- |
| `tasks` | Standard CRUD for `Task`, scoped to a `Project`; publishes `task.updated`/`task.completed` events on update (never on create). |
| `projects` | Standard CRUD for `Project`, with member/owner validation and optimistic-locking (`version`, `expectedVersion`) on update. |
| `customers` | Standard CRUD for customer records, with project-link validation and a `customer.created` event on create. |
| `meetings` | Standard CRUD for meeting records scoped to a project, publishing `meeting.created`/`meeting.updated` events. |
| `documents` | CRUD for document metadata plus file upload to Supabase Storage, linked to Project/Meeting/Tasks — no parsing or embedding logic lives here. |
| `emails` | CRUD/logging only for `Email` records as metadata tied to a customer/project — no actual sending, no SMTP, no inbox sync. |

### Knowledge layer (P2-P4)

| Directory | Purpose |
| --- | --- |
| `library` | Knowledge Library CRUD (folders/tags/uploads): validates, virus-scans, uploads, parses + chunks a file, then fires the graph-extraction and embedding pipelines as side effects. |
| `graph` | Automatic knowledge-graph "Smart Linking" — regex-based entity extraction via `@bond-os/extraction` on document upload, dedup/resolution, and `Entity`/`Relationship`/`TimelineEvent` creation. No ML. |
| `retrieval` | The RAG retrieval layer: `hybrid-search.service.ts` blends full-text + pgvector semantic + relationship-proximity + recency signals; its own doc comment states "No LLM calls. Only retrieve." |
| `embeddings` | Vector-embedding generation/storage pipeline for NOTE/EMAIL/MEETING/CHUNK sources via a pluggable provider, tracking `EmbeddingJob` rows and org-wide rebuild/reindex. |
| `search` | Metadata-only global search fanning out to each entity feature's existing `list*Service` plus Postgres full-text search for the Library — zero AI. |

### AI copilot (P5)

| Directory | Purpose |
| --- | --- |
| `bond` | Mr. Bond's RAG chat pipeline: `rag-pipeline.service.ts`'s `runBondChatPipeline` runs query-rewrite → hybrid search → prompt-build → LLM → SSE streaming → citation validation → suggested questions, as an async generator. |
| `ai` | Composition root for text-generation providers: `ai-provider.service.ts` builds/caches provider clients from env vars; `ai.service.ts` exposes an org-scoped, audit-logged model list/health/token-count surface. |

### Tool Execution Framework (P6)

| Directory | Purpose |
| --- | --- |
| `planner` | AI-driven execution planning, backend-only: converts a `<<ACTION:tool_key>>` marker into a validated, hashed DAG `ExecutionPlan` — "produces plans, no execution occurs." |
| `tools` | The generic Tool SDK/registry: `ToolRegistryService` keyed by `toolKey@version`; `lib/tool-definition.ts` defines the 8-method contract every tool implements (schema, permissions, estimate, validate, preview, execute, rollback, describe). |
| `execution` | The Execution Engine: `ExecutionService.executeApprovedPlan` gates every write behind approval, resolves each DAG step's tool from the Tool Registry, and runs layer-by-layer with retry/rollback — "the AI never executes tools directly." |
| `approvals` | The atomic, single-use approve/reject gate on `ExecutionPlan`s via a conditionally-scoped `updateMany`, enforcing role sufficiency and publishing `approval.*` events. |
| `audit` | The immutable, append-only compliance trail for the Tool Execution Framework's write lifecycle (`record`/`listForExecution`) — never edited or deleted. |
| `rollback` | Reverses already-succeeded steps of a failed multi-step tool execution, in reverse order, calling each tool's own `.rollback()`. |

### Multi-agent architecture (P7)

| Directory | Purpose |
| --- | --- |
| `agents` | Multi-agent orchestration: `registry.ts` composes 6 concrete agent personas (Coordinator + 5 specialists); `agent-pipeline.service.ts`'s `runThinkLoop` is the shared retrieve → prompt → tool/delegate-dispatch → stream reasoning loop plus agent-to-agent handoff. |

### Workflow platform (P8)

| Directory | Purpose |
| --- | --- |
| `workflows` | The persisted, re-entrant workflow automation engine: `workflow-run.service.ts`'s `driveWorkflowRun` executes a step DAG layer-by-layer, pausing on `WAITING_APPROVAL`/`WAITING_TIMER`; `workflow-tick.service.ts` is the sole externally-polled entry point (no background daemon). |

### Collaboration (P9)

| Directory | Purpose |
| --- | --- |
| `collaboration` | Real-time presence and dashboard aggregation: `presence.service.ts` does ephemeral, `Cache`-only (never Postgres) heartbeat presence; `dashboard.service.ts` aggregates pending approvals/active runs/unread notifications from existing queries; `lib/realtime-channel.ts` is the shared reconnecting-SSE poll primitive every "live" surface uses. |
| `comments` | Threaded comment/reply CRUD across 6 entity types (Project, Task, Meeting, Document, Customer, GraphNode), with `@mention` validation and file attachments. |
| `notifications` | Two-sided notification infrastructure: `notification.service.ts` is the read/manage side (inbox, mark-read, archive, snooze); `notification-fanout.service.ts` is the write side, triggered by the Event Bus. |
| `spaces` | "Team Spaces" — a pure curation/grouping layer linking Projects, Documents, Workflows, and Agents; explicitly **not** an access-control layer. |
| `activity` | A thin, org-scoped read-only wrapper over the event log — `listActivityFeedService` role-checks then delegates straight to `listEvents`. |

### Connectors (P2 scaffold, still architecture-only)

| Directory | Purpose |
| --- | --- |
| `connectors` | Pure catalog/record management merging a static `CONNECTOR_CATALOG` with the org's saved connector rows — upserts/deletes a DB row on connect/disconnect; no OAuth or sync logic lives here. |
| `sync` | Triggers a manual sync job for a connected external `Connector` via `@bond-os/connectors`; currently always fails, since every connector provider is a stub that throws `ConnectorNotImplementedError`. |

### Shared

| Directory | Purpose |
| --- | --- |
| `shared` | The thinnest directory in the codebase — exactly two presentational components (`PriorityBadge`, `QuerySelectFilter`), no services, no `lib/`. Flagged here explicitly since every other feature has real business logic behind it. |

## `packages/*` — every package, one line each

| Package | Real contents (verified, not a placeholder description) |
| --- | --- |
| `@bond-os/config` | `tsconfig.base/nextjs/react-library.json`, an ESLint flat-config base, and a Tailwind preset (design-token color/radius mapping). No runtime `src/` code at all. |
| `@bond-os/shared` | Env validation (Zod, fail-fast at boot), the centralized `pino`-based logger, the `AppError` hierarchy, `Cache` (in-memory/Redis), `RateLimiter` (in-memory only, see [scalability.md](./scalability.md)), a `Queue` interface with nothing consuming it, virus-scan hook, and every feature's Zod input schemas — split into a client-safe barrel (`index.ts`) and a `server-only`-gated barrel (`server.ts`). |
| `@bond-os/database` | The Prisma schema (67 models / 46 enums), the generated client (gitignored output), 50 repository files (one per aggregate: `tasks.ts`, `projects.ts`, `workflow-runs.ts`, …), a handful of multi-model `queries/` (e.g. `createOrganizationWithWorkspace`), and the dev seed script. |
| `@bond-os/auth` | Better Auth server (`betterAuth()` instance, Prisma adapter, email/password) and client config, `requireAuth`/`requireRole(organizationId, role)` session helpers, and a dual-mode email provider (console in dev, real SMTP via `nodemailer` once `SMTP_HOST` is set). |
| `@bond-os/ui` | A hand-authored, shadcn/ui-style component library — Radix UI primitives for behavior/accessibility, `class-variance-authority` for style variants — copied into the repo (not an installed dependency) so it's fully editable. |
| `@bond-os/ai` | Text-generation provider abstraction: one `AIProvider` interface, four real REST-backed implementations (`providers/{openai,anthropic,gemini,ollama}.ts`, all raw `fetch`, no vendor SDK), a pure `createAIProvider()` factory, and a shared cl100k_base tokenizer. Actually called today from `apps/web/features/bond/` and `apps/web/features/agents/` — see the staleness note in [request-flow.md](./request-flow.md#notable-code-verified-details). |
| `@bond-os/embeddings` | The equivalent abstraction for embeddings: OpenAI/Gemini/Voyage/Ollama providers plus `providers/local-hash.ts`, a deterministic FNV-1a hash fallback with no network call and no API key — the zero-config default. |
| `@bond-os/connectors` | A connector framework (`BaseConnector`, a `catalog.ts` of 7 providers, a registry) that is genuinely architecture-only — every provider file is a one-line subclass, and `connect()`/`sync()`/`webhook()` all throw `ConnectorNotImplementedError` on the base class. |
| `@bond-os/extraction` | Rule-based (regex/dictionary/heuristic) entity-candidate extraction — emails, phone numbers, URLs, dates, person/company names, meeting/project mentions — explicitly "no AI, no ML, no embeddings," feeding the Knowledge Graph's Smart Linking. |
| `@bond-os/parsers` | Non-AI document text extraction (PDF/DOCX/TXT/Markdown/CSV) plus heuristic text chunking and a content-hash utility (`hashContent`, also reused by the approval engine's `planHash` integrity check). |

## `packages/database/src/repositories/` — 50 files, confirmed by directory listing

One file per aggregate, matching the Prisma model it wraps: `agent-goals.ts`, `agent-timeline-events.ts`,
`agents.ts`, `ai-audit-log.ts`, `approval-requests.ts`, `audit-events.ts`, `chunks.ts`, `comments.ts`,
`connectors.ts`, `conversation-shares.ts`, `conversations.ts`, `customers.ts`, `documents.ts`, `emails.ts`,
`embedding-jobs.ts`, `embeddings.ts`, `entities.ts`, `entity-version-snapshots.ts`, `events.ts`,
`execution-plans.ts`, `execution-steps.ts`, `folders.ts`, `goal-steps.ts`, `graph-nodes.ts`, `graph.ts`,
`insights.ts`, `knowledge-documents.ts`, `meetings.ts`, `mentions.ts`, `messages.ts`, `notifications.ts`,
`organization-ai-settings.ts`, `projects.ts`, `relationships.ts`, `rollback-records.ts`, `search.ts`,
`shared.ts`, `sources.ts`, `spaces.ts`, `sync-jobs.ts`, `tags.ts`, `tasks.ts`, `timeline.ts`,
`tool-executions.ts`, `tools.ts`, `workflow-definitions.ts`, `workflow-run-steps.ts`, `workflow-runs.ts`,
`workflow-schedules.ts`, `workflow-webhook-deliveries.ts`.

Every one of these follows the same shape: plain Prisma Client calls, `organizationId` scoping via
`where`, `updateMany`/`deleteMany` instead of unique `update`/`delete`, and `null`/`boolean` return
signals instead of thrown errors — see
[design-principles.md](./design-principles.md#repositories-return-signals-services-throw).

## Why this shape

- **Feature-first, not type-first.** No repo-wide `components/`, `utils/`, or `hooks/` dumping ground —
  each package/route owns exactly what it needs.
- **Packages own a concern, not a layer.** `@bond-os/auth` is the entire auth concern end to end, not
  "backend code that happens to relate to auth."
- **`apps/web/lib/*` has no grab-bag file.** Each helper (`api-handler.ts`, `csrf.ts`, `organization.ts`,
  `supabase.ts`) has exactly one named responsibility.

## Further reading

- [system-architecture.md](./system-architecture.md) — how these directories relate at the architecture
  level, including the Component-level C4 diagram.
- [design-principles.md](./design-principles.md) — the conventions that keep 29 feature directories from
  becoming an unmanageable web of cross-imports.
- [docs/development/adding-features.md](../development/adding-features.md) — how to add a new feature
  directory following this same shape.
