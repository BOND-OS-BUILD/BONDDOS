# BOND OS

**The AI-native operating system for startups.**

BOND OS is a company-memory platform: it holds an organization's projects, tasks, documents, meetings,
and customers; builds a knowledge graph and a retrieval-augmented memory over that data; and layers an
AI copilot ("Mr. Bond"), a multi-agent workforce, an approval-gated tool-execution framework, and an
event-driven workflow automation platform on top — all inside one multi-tenant, role-scoped monorepo.

This repository has been built phase by phase (P0 through P9), each phase's scope and boundaries
recorded as it was built in `docs/*.md`. It is a real, working codebase, not a demo: every capability
listed below is implemented and traceable to source. Several pieces are explicitly infrastructure-only
or architecture-only (no OAuth yet, no live AI text-generation call path yet) — that is called out
plainly in [Roadmap](#roadmap), not hidden.

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Features](#features)
- [Installation](#installation)
- [Screenshots](#screenshots)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [AI Architecture](#ai-architecture)
- [Workflow Engine](#workflow-engine)
- [Agents](#agents)
- [Collaboration](#collaboration)
- [Roadmap](#roadmap)
- [License](#license)
- [Contributing](#contributing)
- [Documentation](#documentation)

## Project Overview

BOND OS is organized around one idea: every organization's operational data (Projects, Tasks,
Documents, Meetings, Customers, Emails) becomes a single queryable knowledge graph, which an AI
copilot can retrieve from, reason over, and — only with an explicit human approval step — act on. Each
phase added one layer without touching the ones below it:

| Phase | What it added |
| --- | --- |
| P0 | Auth, organizations/roles, monorepo scaffolding, UI kit — zero AI logic |
| P1 | Company data: Projects, Tasks, Documents, Meetings, Customers, Emails |
| P2 | Data layer: universal `Entity` system, Knowledge Library, chunking, connector/sync scaffolding |
| P3 | Knowledge Graph: typed relationships, entity resolution, timeline |
| P4 | AI memory & retrieval: pluggable embeddings, pgvector search, citations |
| P5 | Mr. Bond: read-only RAG chat copilot |
| P6 | Tool Execution Framework: approval-gated writes, audit trail, rollback |
| P7 | Multi-Agent Architecture: a Coordinator over 5 specialist agents |
| P8 | Workflow Automation Platform: Event Bus, visual workflow builder, scheduling |
| P9 | Enterprise Collaboration: presence, comments/mentions, notifications, spaces, shared editing |

Every tenant boundary in the system is enforced the same way: almost every table carries
`organizationId` directly, and every service call is authorized through `requireRole(organizationId,
role)` before touching the database.

## Architecture

Every write in BOND OS flows through the same four layers, in the same order, for every feature:

**Repository** (`packages/database/src/repositories/*.ts`, plain Prisma, org-scoped) → **Service**
(`apps/web/features/<feature>/services/*.service.ts`, calls `requireRole()` then the repository) →
**API Route** (`apps/web/app/api/<feature>/**/route.ts`, wrapped in `apiHandler()`, CSRF-checked on
mutations) → **UI** (a Server Component page that calls the service directly, plus `'use client'`
tables/dialogs that call the API route).

Three deliberately-repeated architectural patterns run through the codebase: a **lazy-singleton
composition root** (`features/*/lib/container.ts`) for every class-based service; a **registry-as-
single-source-of-truth** file (`features/{tools,agents,workflows}/registry.ts`) that is the only place
in the codebase allowed to import every concrete tool/agent/step-handler implementation; and a
**dynamic-import event publisher** (`getPublishEvent()`) that lets domain services publish to the Event
Bus without creating an import cycle back through the Tool Registry.

Full detail — request-flow diagrams, the composition-root pattern, the error hierarchy, the
`ApiResponse<T>` envelope, environment variables — lives in **[docs/architecture/overview.md](docs/architecture/overview.md)**.

## Features

### Company Data (P1)
Project, Task, Document, Meeting, Customer, and Email CRUD, each organization-scoped and role-checked.
Projects/Documents/Meetings carry an optimistic-locking `version` (added in P9); Tasks do not — a real,
unexplained gap, not a design choice.

### Knowledge Library & Data Layer (P2)
A universal `Entity` system (Document/Meeting/Note/Customer/Email/Contact/Website/File) with a folder
tree, non-AI document parsing and heuristic chunking (`@bond-os/parsers`), tagging, and a connector/
sync-job scaffold (`@bond-os/connectors`) that is architecture-only — no live OAuth flow exists yet.

### Knowledge Graph (P3)
Typed entity relationships (`RelationshipType`, confidence-scored), rule-based entity extraction and
resolution (`@bond-os/extraction` — regex/heuristic, explicitly no AI), and a per-entity activity
timeline.

### AI Memory & Retrieval (P4)
Pluggable embedding providers (OpenAI/Gemini/Voyage/Ollama/a zero-config local fallback), pgvector-
backed similarity search, hybrid retrieval, and a Citation Engine so every retrieved result carries a
document/page/chunk/entity/confidence reference.

### Mr. Bond AI Copilot (P5)
A read-only RAG chat pipeline: retrieve → build context under a token budget → build a prompt → stream
a response, with full conversation memory. No writes, no agents, no tool execution in this layer.

### Tool Execution Framework (P6)
The write path Mr. Bond and every agent use: Plan → Preview → **Approval** → Execute → Audit → optional
Rollback. Every tool is discovered through a single Tool Registry (5 tools registered today), never
hardcoded by name. Approval is an atomic, single-use, replay-safe status transition, not a signed
token.

### Multi-Agent Architecture (P7)
Mr. Bond promoted to a Coordinator over 5 specialist agents (Project, Sales, Operations, Knowledge,
Finance), sharing one 9-method Agent SDK and one Agent Registry (6 agents registered, including the
Coordinator). Every agent write still goes through the unmodified P6 chain via `proposeAction()` — no
agent ever calls a tool's `execute()` directly. Long-running Goals follow an explicit
Plan/Observe/Suggest/Wait/Continue lifecycle with no automatic/timer-driven execution.

### Workflow Automation Platform (P8)
A synchronous, in-process Event Bus (`publishEvent()`) that a curated set of domain services call after
their own write succeeds, dispatching to a visual, org-authored workflow builder (10 step-handler
types), condition trees, retry policies, cron-style scheduling, and replay-protected webhooks — all
resumed via one externally-triggered tick endpoint, since there is no background worker process
anywhere in this codebase.

### Enterprise Collaboration (P9)
Presence and live updates over reconnecting SSE (deliberately not WebSockets or CRDTs — see
[Roadmap](#roadmap)); threaded comments with structured `@mentions`; a unified notification inbox
fanned out from the Event Bus; an organization Activity Feed built by querying the existing `Event`
table; Team Spaces (curation, explicitly **not** an access-control layer); shared/collaborative AI
conversations with per-conversation READ/COLLABORATE permissions; and optimistic-locking version
conflicts (`ConflictError` on a stale write) for Project/Document/Meeting.

## Installation

**Prerequisites:** Node.js 20+, [pnpm](https://pnpm.io) (via `corepack`), a PostgreSQL database (local
via the bundled `docker-compose.yml`, or any hosted instance), and Docker only if you want the bundled
Postgres/Redis or the production image.

```bash
corepack pnpm install
cp .env.example .env              # fill in DATABASE_URL, BETTER_AUTH_SECRET at minimum
docker compose up -d postgres     # or point DATABASE_URL at any Postgres instance
corepack pnpm db:migrate
corepack pnpm dev
```

Redis, Supabase Storage, SMTP, and every AI/embedding provider are all optional with safe fallbacks
(in-memory cache, a clear storage-not-configured error, console-logged emails, a zero-config local
embedding provider). Full walkthrough, every environment variable, and troubleshooting notes (including
a Windows-specific `next build` symlink caveat) are in **[docs/deployment/local.md](docs/deployment/local.md)**
(originating content: `docs/Setup.md`).

## Screenshots

_Not yet available._ This section is a placeholder — no product screenshots have been captured for this
repository yet. When they exist, they belong here, one per major surface (Dashboard, Mr. Bond chat,
Workflow Builder, Knowledge Graph, Inbox).

## Quick Start

```bash
corepack pnpm install
cp .env.example .env
docker compose up -d postgres
corepack pnpm db:migrate
corepack pnpm db:seed             # optional: seeds an organization + workspace, no login
corepack pnpm dev
```

Visit `http://localhost:3000`, sign up, and the first organization you create becomes your active
workspace (the seed script deliberately does not create a working login — sign up for a real account
instead; it follows the same `createOrganizationWithWorkspace` path production traffic uses).

| Script | What it does |
| --- | --- |
| `pnpm dev` | Start the Next.js dev server (all packages, via Turborepo) |
| `pnpm build` | Production build of every package/app |
| `pnpm lint` | Lint every package/app |
| `pnpm typecheck` | Type-check every package/app |
| `pnpm format` | Format the repo with Prettier |
| `pnpm db:migrate` | Apply Prisma migrations (dev) |
| `pnpm db:migrate:deploy` | Apply Prisma migrations (production, non-interactive) |
| `pnpm db:seed` | Seed demo data (an organization + workspace) |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm --filter @bond-os/database run validate` | `prisma validate` — schema-only check, no DB connection required |

## Project Structure

```
apps/
  web/                 Next.js 15 App Router app — app/(auth), app/(dashboard), app/api,
                        features/ (29 feature directories: repository→service→route→UI per feature)
packages/
  config/              Shared TypeScript/ESLint/Tailwind presets
  shared/              Env validation, logging, errors, cache, rate-limit, zod schemas, shared types
  database/             Prisma schema (67 models / 46 enums), generated client, repositories, seed
  auth/                Better Auth server/client config, session + role-authorization helpers
  ui/                  Reusable component library (Radix primitives + cva)
  ai/                  AI provider abstraction — infrastructure only, no live generate()/stream() caller yet
  embeddings/          Pluggable embedding provider architecture
  connectors/          Connector framework — architecture only, no OAuth yet
  extraction/          Rule-based (regex/heuristic) entity-candidate extraction — no AI
  parsers/             Non-AI document parsing and heuristic chunking
docs/                  Full documentation suite (see docs/README.md)
```

Full folder-by-folder tour, including every `apps/web/features/*` and `packages/database/src/repositories/*`
purpose, is in **[docs/architecture/folder-structure.md](docs/architecture/folder-structure.md)**.

## AI Architecture

Mr. Bond's read-only chat pipeline (retrieval → context building → prompting → streaming, P5) and the
approval-gated write pipeline agents and tools share (P6/P7) are documented together with the pluggable
embedding/retrieval layer they both sit on (P4). Note: `@bond-os/ai`'s own `package.json` states
plainly that it is **"infrastructure only — nothing in this codebase calls generate()/stream() yet"**;
Mr. Bond's actual model calls live in `apps/web/features/bond/` and `apps/web/features/planner/`, not
in that package. Full detail in **[docs/ai/](docs/ai/)**.

## Workflow Engine

An event-driven automation platform (P8): a synchronous, in-process Event Bus that a curated set of
domain services publish to after their own write succeeds; a visual, org-authored workflow builder
(trigger + condition tree + a flat DAG graph, versioned and frozen on publish); 10 step-handler types
(read data, search knowledge, invoke agent, invoke tool, wait, branch, delay, loop, notification,
generate report); cron-style scheduling and replay-protected webhooks, both resumed through one
externally-triggered tick endpoint rather than a background worker. Full detail in
**[docs/workflows/](docs/workflows/)**.

## Agents

A 9-method Agent SDK shared by a Chief Coordinator ("Mr. Bond") and 5 specialists (Project, Sales,
Operations, Knowledge, Finance), backed by one in-memory Agent Registry and a shared `BaseAgent`. Every
agent write flows through the unmodified P6 Tool Execution Framework via `proposeAction()` — no agent
calls a tool's `execute()` directly. Long-running Goals (Plan/Observe/Suggest/Wait/Continue) and
structured, chain-of-thought-free Agent Timeline events are both explicitly non-autonomous: nothing in
this codebase advances a Goal on a timer. Full detail in **[docs/agents/](docs/agents/)**.

## Collaboration

Presence, live dashboards, and notifications run over a reconnecting Server-Sent-Events primitive with
Cache-backed snapshot polling — not WebSockets, and presence itself is never persisted to Postgres
(TTL-based in `Cache` only, by design). Threaded comments with structured `@mentions`, a unified
notification inbox, an Activity Feed built from the existing `Event` table, Team Spaces (content
curation, explicitly not an access-control layer), shared AI conversations, and optimistic-locking
version conflicts for Project/Document/Meeting are all covered in
**[docs/collaboration.md](docs/collaboration.md)** and **[docs/api/collaboration.md](docs/api/collaboration.md)**.

## Roadmap

The following are **explicitly out of scope**, stated plainly in the phase that would have introduced
them — not gaps discovered later, but boundaries each phase's own documentation commits to:

- **No CRDT / no operational-transform merge algorithm.** Shared editing (P9) is optimistic-locking
  only: a stale write throws `ConflictError`; the client shows both versions for a human to reconcile.
- **No WebSocket server.** Realtime (P9) is SSE + reconnect, chosen specifically to keep the app
  deployable both as a Docker container and on Vercel without committing to one always-on process.
- **No public/external sharing.** Conversation sharing (P9) is always to a specific org member —
  never public, never cross-organization.
- **No background worker / job queue consumer.** `Queue` (`packages/shared/src/queue.ts`) is an
  always-in-memory interface with nothing consuming it. Every retry/scheduling mechanism in the schema
  (`SyncJob`, `EmbeddingJob`, workflow scheduling, Wait/Delay steps) is either manually triggered or
  driven by one externally-invoked tick/cron endpoint — never an in-process daemon.
- **No live OAuth connector sync.** `@bond-os/connectors` is architecture only; `Connector.config` is a
  placeholder for future OAuth tokens, and no OAuth flow exists yet.
- **No AI-based entity extraction.** `@bond-os/extraction` is regex/heuristic only, by explicit design.
- **No live AI text generation call path in `@bond-os/ai`.** The package's own `package.json`
  description states nothing calls `generate()`/`stream()` yet; Mr. Bond's real model calls are
  implemented directly in `apps/web/features/bond/` and `features/planner/`.
- **No automated test suite yet.** There is no `test` script in any `package.json`, no test framework
  dependency, and no CI configuration (no `.github/workflows`) anywhere in this repository. Verification
  has so far been manual and is recorded per-commit: `prisma validate`, `typecheck`, `lint`, `build`, a
  dev-server smoke test, and a regression spot-check. See
  [Testing requirements in CONTRIBUTING.md](CONTRIBUTING.md#testing-requirements) and
  **[docs/testing/strategy.md](docs/testing/strategy.md)** for the honest current state and what a real
  suite would need to cover.
- **No field-level secret encryption.** `WorkflowDefinition.webhookSecret`, `Account.accessToken`/
  `refreshToken`, and `Account.password` are plaintext columns at rest — there is no field-level
  encryption utility in this codebase yet.
- **`Task` has no optimistic-locking `version` field**, unlike `Project`/`Document`/`Meeting`/`Entity` —
  a genuine, unexplained P9 coverage gap rather than a documented exclusion.
- **Presence has no `Notification` fallback for `@agent` mentions** — recorded, never notified; agents
  have no inbox and no single unambiguous recipient.

## License

Not yet specified. No `LICENSE` file and no `license` field in any `package.json` currently exist in
this repository.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for repository standards, the commit convention, the review
checklist this project actually uses, and coding/documentation/testing requirements for new work.

## Documentation

The full documentation index — every architecture, database, API, AI, workflow, agent, security,
deployment, development, testing, and release doc — lives at **[docs/README.md](docs/README.md)**.
