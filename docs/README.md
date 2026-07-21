# BOND OS Documentation

BOND OS is a company-memory platform built phase by phase (P0–P9): organization data (Projects, Tasks,
Documents, Meetings, Customers, Emails) becomes a knowledge graph; an AI copilot ("Mr. Bond") and a
multi-agent workforce retrieve from and reason over it; an approval-gated tool-execution framework lets
them act on it; and an event-driven workflow platform automates it — all inside one multi-tenant,
role-scoped monorepo (`apps/web` = Next.js 15 App Router, `packages/*` = shared libraries).

This page is the index for the full documentation suite: the reorganized reference docs under each
`docs/<topic>/` directory below, plus the 49 phase-era docs in `docs/*.md` that were written incrementally
as each phase (P0–P9) was built and that the reorganized docs summarize and link out to for implementation
detail.

For the top-level project summary (features, installation, roadmap, what is explicitly out of scope) see
**[../README.md](../README.md)**. For how contributions actually get made in this repository (branching,
commit conventions, the review checklist, documentation requirements) see
**[../CONTRIBUTING.md](../CONTRIBUTING.md)**.

## Start here

New to the codebase? Read these three, in order, before anything else:

1. **[architecture/overview.md](architecture/overview.md)** — what BOND OS is, the phase-by-phase build
   (P0–P9), and the four-layer request path every feature follows.
2. **[architecture/system-architecture.md](architecture/system-architecture.md)** — how the pieces fit
   together: the monorepo layout, the composition-root/registry/event-bus patterns, and where each
   subsystem (data layer, knowledge graph, AI, tools, agents, workflows, collaboration) lives.
3. **[development/setup.md](development/setup.md)** — get it running locally: prerequisites, environment
   variables, `pnpm dev`, and the seed script.

From there, the sections below map to whatever part of the system you're working on.

## Architecture

How the system is put together: layering, request flow, folder layout, and the design decisions behind
them.

- **[architecture/overview.md](architecture/overview.md)** — system overview and the phase-by-phase build.
- **[architecture/system-architecture.md](architecture/system-architecture.md)** — full system architecture: monorepo layout and cross-cutting patterns.
- **[architecture/request-flow.md](architecture/request-flow.md)** — the Repository → Service → API Route → UI request path used by every feature.
- **[architecture/folder-structure.md](architecture/folder-structure.md)** — folder-by-folder tour of `apps/web` and `packages/*`.
- **[architecture/design-principles.md](architecture/design-principles.md)** — the recurring patterns: lazy-singleton composition roots, registries as the single source of truth, the dynamic-import event publisher.
- **[architecture/architecture-decisions.md](architecture/architecture-decisions.md)** — recorded architecture decisions and the tradeoffs behind them (e.g. SSE over WebSockets, no CRDT, no background worker).
- **[architecture/scalability.md](architecture/scalability.md)** — scaling considerations and current limits.

C4-model diagrams (System Context/Container/Component/Code) and sequence diagrams (chat, tool
execution, workflow triggers) are not separate files — they're embedded directly in
**[architecture/system-architecture.md](architecture/system-architecture.md)** (C4 diagrams) and
**[architecture/request-flow.md](architecture/request-flow.md)** (sequence diagrams), a deliberate
deviation from an earlier plan to split them out, made when this documentation suite's own batch scope
was finalized.

## Database

The Prisma schema (`packages/database/prisma/schema.prisma`) and how it's evolved.

- **[database/erd.md](database/erd.md)** — entity-relationship diagram of the schema.
- **[database/schema.md](database/schema.md)** — models, enums, and the tenancy convention (`organizationId` on every tenant-owned table).
- **[database/relationships.md](database/relationships.md)** — foreign keys and cross-model relationships, including the typed knowledge-graph relationships.
- **[database/migrations.md](database/migrations.md)** — migration history and how to add a new migration.

## API Reference

Every `apps/web/app/api/**/route.ts` surface, grouped by domain.

- **[api/authentication.md](api/authentication.md)** — auth endpoints (Better Auth), session handling.
- **[api/organizations.md](api/organizations.md)** — organizations, membership, and role management.
- **[api/ai.md](api/ai.md)** — AI/embedding-provider–facing endpoints.
- **[api/graph.md](api/graph.md)** — knowledge graph query endpoints.
- **[api/workflows.md](api/workflows.md)** — workflow builder, triggers, scheduling, and webhook endpoints.
- **[api/agents.md](api/agents.md)** — agent invocation, goals, and delegation endpoints.
- **[api/tools.md](api/tools.md)** — tool execution: propose/preview/approve/execute/rollback endpoints.
- **[api/collaboration.md](api/collaboration.md)** — presence, comments, notifications, spaces, and shared-conversation endpoints.
- **[api/search.md](api/search.md)** — retrieval and search endpoints.
- **[api/system.md](api/system.md)** — health/system-level endpoints.
- **[api/company-data.md](api/company-data.md)** — Project/Task/Document/Meeting/Customer/Email CRUD endpoints.
- **[api/bond.md](api/bond.md)** — Mr. Bond chat endpoints.
- **[api/connectors-sync.md](api/connectors-sync.md)** — connector and sync-job endpoints (architecture-only; no live OAuth flow).

## AI

Mr. Bond's retrieval-augmented chat pipeline and the shared AI/embedding infrastructure underneath it.

- **[ai/providers.md](ai/providers.md)** — AI provider abstraction (`@bond-os/ai`) — infrastructure only; see the note below.
- **[ai/retrieval.md](ai/retrieval.md)** — hybrid retrieval over the knowledge base.
- **[ai/embeddings.md](ai/embeddings.md)** — pluggable embedding providers (OpenAI/Gemini/Voyage/Ollama/local fallback).
- **[ai/rag.md](ai/rag.md)** — the retrieve → build context → build prompt → stream response pipeline.
- **[ai/prompt-builder.md](ai/prompt-builder.md)** — prompt construction.
- **[ai/citations.md](ai/citations.md)** — the Citation Engine: document/page/chunk/entity/confidence references.
- **[ai/memory.md](ai/memory.md)** — conversation memory.
- **[ai/context-builder.md](ai/context-builder.md)** — context assembly under a token budget.
- **[ai/tool-calling.md](ai/tool-calling.md)** — how agents and Mr. Bond invoke tools via `proposeAction()`.
- **[ai/model-selection.md](ai/model-selection.md)** — model-selection logic.

> **Known gap, stated plainly:** `@bond-os/ai`'s own `package.json` states it is infrastructure only —
> nothing in this codebase calls `generate()`/`stream()` from that package yet. Mr. Bond's actual model
> calls live in `apps/web/features/bond/` and `apps/web/features/planner/`. See
> **[../README.md](../README.md)** and the deep-dive docs below (`shared-ai.md`, `ai-service.md`) for
> detail.

## Knowledge Graph

Typed entity relationships, rule-based extraction, and per-entity timelines (P3).

- **[knowledge/graph.md](knowledge/graph.md)** — the knowledge graph model and how it's queried.
- **[knowledge/entities.md](knowledge/entities.md)** — the universal `Entity` system (Document/Meeting/Note/Customer/Email/Contact/Website/File).
- **[knowledge/relationships.md](knowledge/relationships.md)** — typed, confidence-scored `RelationshipType` relationships.
- **[knowledge/extraction.md](knowledge/extraction.md)** — rule-based entity-candidate extraction (`@bond-os/extraction` — regex/heuristic, explicitly no AI).
- **[knowledge/resolution.md](knowledge/resolution.md)** — entity resolution.
- **[knowledge/timeline.md](knowledge/timeline.md)** — the per-entity activity timeline.

## Workflows

The event-driven automation platform (P8).

- **[workflows/overview.md](workflows/overview.md)** — workflow platform overview.
- **[workflows/event-bus.md](workflows/event-bus.md)** — the synchronous, in-process Event Bus (`publishEvent()`) and the `getPublishEvent()` dynamic-import pattern.
- **[workflows/scheduler.md](workflows/scheduler.md)** — cron-style scheduling, resumed via one externally-triggered tick endpoint (no background worker process).
- **[workflows/workflow-engine.md](workflows/workflow-engine.md)** — the workflow execution engine: trigger, condition tree, flat DAG graph.
- **[workflows/builder.md](workflows/builder.md)** — the visual, org-authored workflow builder and its 10 step-handler types.
- **[workflows/templates.md](workflows/templates.md)** — workflow templates.
- **[workflows/retries.md](workflows/retries.md)** — retry policies.
- **[workflows/approvals.md](workflows/approvals.md)** — approval-gated workflow steps.

## Agents

The multi-agent architecture (P7): a Coordinator over 5 specialist agents sharing one Agent SDK.

- **[agents/overview.md](agents/overview.md)** — agents overview: the Coordinator ("Mr. Bond") and 5 specialists (Project, Sales, Operations, Knowledge, Finance).
- **[agents/base-agent.md](agents/base-agent.md)** — the shared 9-method Agent SDK / `BaseAgent`.
- **[agents/registry.md](agents/registry.md)** — the Agent Registry (single source of truth for every registered agent).
- **[agents/routing.md](agents/routing.md)** — how the Coordinator routes to specialists.
- **[agents/delegation.md](agents/delegation.md)** — agent-to-agent delegation.
- **[agents/goals.md](agents/goals.md)** — long-running Goals and the explicit Plan/Observe/Suggest/Wait/Continue lifecycle (non-autonomous — nothing advances a Goal on a timer).
- **[agents/insights.md](agents/insights.md)** — agent-generated insights.
- **[agents/communication.md](agents/communication.md)** — structured, chain-of-thought-free Agent Timeline events.

## Security

Authentication, authorization, tenant isolation, and the threat model.

- **[security/authentication.md](security/authentication.md)** — Better Auth session handling.
- **[security/authorization.md](security/authorization.md)** — `requireRole(organizationId, role)` and where it's enforced.
- **[security/permissions.md](security/permissions.md)** — role/permission model.
- **[security/organization-isolation.md](security/organization-isolation.md)** — multi-tenant isolation: `organizationId` on every tenant-owned table.
- **[security/audit.md](security/audit.md)** — the audit trail for tool execution.
- **[security/approvals.md](security/approvals.md)** — the approval gate: an atomic, single-use, replay-safe status transition (not a signed token).
- **[security/threat-model.md](security/threat-model.md)** — threat model.
- **[security/prompt-injection.md](security/prompt-injection.md)** — prompt-injection considerations for the AI/tool-execution surfaces.
- **[security/secrets.md](security/secrets.md)** — secret handling, including the known gap: `WorkflowDefinition.webhookSecret`, `Account.accessToken`/`refreshToken`, and `Account.password` are plaintext columns today (no field-level encryption utility exists yet).

## Deployment

Running BOND OS locally, in Docker, and in production.

- **[deployment/local.md](deployment/local.md)** — local setup (originating content: `docs/Setup.md`).
- **[deployment/production.md](deployment/production.md)** — production deployment.
- **[deployment/docker.md](deployment/docker.md)** — the bundled `Dockerfile` and `docker-compose.yml`.
- **[deployment/environment.md](deployment/environment.md)** — every environment variable and its fallback behavior.
- **[deployment/vercel-env.md](deployment/vercel-env.md)** — the Vercel-specific environment variable reference (required/optional, example values, which services depend on each).
- **[deployment/github.md](deployment/github.md)** — GitHub-related setup. **Note:** this repository currently has no `.github/workflows` directory — there is no CI configured yet (confirmed on disk).
- **[deployment/backups.md](deployment/backups.md)** — database backup approach.
- **[deployment/monitoring.md](deployment/monitoring.md)** — monitoring and observability.
- **[deployment/troubleshooting.md](deployment/troubleshooting.md)** — troubleshooting, including the Windows-specific `next build` symlink caveat.

## Development

Setting up, coding standards, and day-to-day workflow.

- **[development/setup.md](development/setup.md)** — local development setup.
- **[development/architecture.md](development/architecture.md)** — architecture from a contributor's-eye view.
- **[development/coding-standards.md](development/coding-standards.md)** — the repository→service→route→UI layering, the composition-root pattern, the registry pattern, naming conventions.
- **[development/adding-features.md](development/adding-features.md)** — how to add a new feature directory.
- **[development/debugging.md](development/debugging.md)** — debugging tips.
- **[development/git-workflow.md](development/git-workflow.md)** — commit conventions and branch strategy (see also **[../CONTRIBUTING.md](../CONTRIBUTING.md)**).

How to verify a change today (there is no automated test suite) is covered in
**[Testing](#testing)** below, not a separate `development/testing.md` file.

## Testing

**[testing/strategy.md](testing/strategy.md)** is the honest starting point here: as of this writing, BOND OS
has **no automated test suite** — no `test` script in any `package.json`, no test-framework dependency, and
no CI configuration anywhere in the repository (confirmed: no `.github/workflows` directory exists).
Verification to date has been manual and recorded per-commit (schema validate, typecheck, lint, build, a
dev-server smoke test, and a regression spot-check — see **[../CONTRIBUTING.md](../CONTRIBUTING.md#review-checklist)**).

- **[testing/strategy.md](testing/strategy.md)** — current testing posture and what a real suite would need to cover.
- **[testing/unit.md](testing/unit.md)** — unit-testing approach (aspirational until a framework is added).
- **[testing/integration.md](testing/integration.md)** — integration-testing approach.
- **[testing/e2e.md](testing/e2e.md)** — end-to-end testing approach.
- **[testing/security.md](testing/security.md)** — security testing (adversarial passes have been run manually for org-isolation, Space ACL boundaries, mention validation, and SSE-channel authorization — see commit `0a70630` referenced in `../CONTRIBUTING.md`).
- **[testing/performance.md](testing/performance.md)** — performance testing.

## Releases

- **[releases/release-process.md](releases/release-process.md)** — how a release is cut.
- **[releases/versioning.md](releases/versioning.md)** — versioning policy.
- **[releases/changelog.md](releases/changelog.md)** — changelog.
- **[releases/checklist.md](releases/checklist.md)** — release checklist.

## Project-level docs

- **[../README.md](../README.md)** — project overview, features by phase, installation, quick start, roadmap (explicitly out-of-scope items), license status.
- **[../CONTRIBUTING.md](../CONTRIBUTING.md)** — repository standards, branch strategy, commit conventions, PR process, review checklist, coding style, documentation and testing requirements.
- **[MANIFEST.md](MANIFEST.md)** — the complete file-by-file manifest of this documentation suite, its verification summary, and known documentation deviations/gaps.
- **docs/README.md** — this page.

## Deep-dive references (phase-era docs)

Before the structure above existed, this project wrote one doc per capability as each phase (P0–P9) was
built. Those 49 files still live flat in `docs/*.md` and hold implementation detail (concrete
functions, tables, and gaps) that the reorganized docs above summarize and link out to — they are not
superseded, and are the primary source the docs above should be checked against. Grouped roughly by the
phase/subsystem each one documents:

**Foundational (P0)**
- [Architecture.md](Architecture.md)
- [FolderStructure.md](FolderStructure.md)
- [Setup.md](Setup.md)

**Data layer & document system (P2)**
- [data-layer.md](data-layer.md)
- [document-system.md](document-system.md)
- [connectors.md](connectors.md)
- [storage.md](storage.md)

**Knowledge graph (P3)**
- [knowledge-graph.md](knowledge-graph.md)
- [relationships.md](relationships.md)
- [entity-resolution.md](entity-resolution.md)
- [graph-api.md](graph-api.md)
- [timeline.md](timeline.md)

**AI memory & retrieval (P4)**
- [embeddings.md](embeddings.md)
- [vector-search.md](vector-search.md)
- [retrieval.md](retrieval.md)
- [search.md](search.md)
- [citations.md](citations.md)
- [shared-ai.md](shared-ai.md)
- [ai-service.md](ai-service.md)
- [memory.md](memory.md)

**Mr. Bond / chat (P5)**
- [mr-bond.md](mr-bond.md)
- [chat.md](chat.md)
- [conversations.md](conversations.md)
- [rag.md](rag.md)
- [context-builder.md](context-builder.md)
- [planner.md](planner.md)

**Tool execution (P6)**
- [tool-execution.md](tool-execution.md)
- [tool-calling.md](tool-calling.md)
- [approvals.md](approvals.md)
- [rollback.md](rollback.md)

**Multi-agent architecture (P7)**
- [multi-agent.md](multi-agent.md)
- [agents.md](agents.md)
- [base-agent.md](base-agent.md)
- [agent-registry.md](agent-registry.md)
- [delegation.md](delegation.md)
- [goals.md](goals.md)
- [insights.md](insights.md)

**Workflow automation (P8)**
- [workflows.md](workflows.md)
- [event-bus.md](event-bus.md)
- [workflow-builder.md](workflow-builder.md)
- [workflow-templates.md](workflow-templates.md)
- [scheduling.md](scheduling.md)
- [retries.md](retries.md)

**Enterprise collaboration (P9)**
- [collaboration.md](collaboration.md)
- [presence.md](presence.md)
- [comments.md](comments.md)
- [notifications.md](notifications.md)
- [activity-feed.md](activity-feed.md)
- [spaces.md](spaces.md)

Total: 49 files, confirmed by directory listing of `docs/*.md` at the time this index was written.
