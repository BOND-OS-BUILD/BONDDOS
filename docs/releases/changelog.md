# Changelog

## Scope

This changelog is derived directly from this repository's real, complete `git log` and its two
existing annotated tags — nothing here is reconstructed from memory or a separate release-notes
process. BOND OS has never published binary releases or a package registry version; "a release" in
this project means an annotated git tag at a milestone commit. See [`versioning.md`](./versioning.md)
for what the tag scheme does and doesn't mean, and [`release-process.md`](./release-process.md) for
how a tag actually gets cut.

## [v1.2.0] — Phase 11: Extensibility Platform

Tag: `v1.2.0`. Turns BOND OS into a platform organizations can extend without
modifying core code. Every subsystem is **additive and reuse-first** — the
public API and GraphQL reuse the dashboard repositories, custom objects reuse the
Knowledge Graph, automations reuse the Workflow Engine, and webhooks/plugins ride
one shared event catalog. The migration is additive-only (new tables use plain
scalar FK columns; `EntityType` gains a `CUSTOM` value), so P0–P10 are unchanged.

- `d0f5e1b` — Phase 11 schema (API keys, webhooks, custom objects, forms, plugins, templates)
- `c861b89` — shared contracts (API scopes, event catalog, field types, schemas)
- `8769d75` — database repositories
- `a8066a3` — personal & organization API keys + public-API auth
- `b2d86d8` — public REST API `/api/v1` + OpenAPI 3.1 + Swagger UI
- `1d4f973` — typed event bus + outbound webhooks (signed, retried, replayable)
- `c95b340` — custom objects + dynamic forms + developer portal
- `4022369` — `@bond-os/sdk` (typed client, event router, webhook verification)
- `7087643` — template marketplace + import/export (JSON + CSV)
- `6e7ca61` — plugin system (lifecycle, isolation, permission validation)
- `1991eeb` — optional read-only GraphQL endpoint
- `8c52f15` — Phase 11 documentation (11 docs)

Verified behind all four gates (`prisma validate` / `typecheck` / `lint` /
`build`) with zero regressions; the additive migration was applied to the
production database and recorded in `_prisma_migrations`. Deliberately **not**
built (out of scope): payments/billing, mobile/desktop apps, autonomous AI,
self-modifying code, or arbitrary code execution.

## [v1.0.0] — BOND OS Foundation Documentation Complete

Tag: `v1.0.0` (pending — created at the end of the documentation batch described below).

The complete engineering documentation suite for BOND OS, covering architecture, database, API
reference, the AI platform, the knowledge graph, the workflow engine, the agent framework, security,
deployment, local development, contribution guidelines, testing strategy, and this release
documentation — generated in 10 independently-verified batches, each gated behind
`prisma validate`/`typecheck`/`lint`/`build` before being committed and pushed:

- `4fb653d` — `docs: architecture documentation`
- `6a6b0f2` — `docs: database documentation`
- `7569f71` — `docs: API reference`
- `0584fa7` — `docs: AI platform documentation`
- `7c1dfad` — `docs: knowledge graph documentation`
- `8bf0367` — `docs: workflow engine documentation`
- `b9a7b2b` — `docs: agent framework documentation`
- `6cdd99b` — `docs: security documentation`
- `1cf9ca9` — `docs: deployment and development documentation`
- (this batch) — `docs: testing and release documentation`

No application code changed in this release — it is documentation-only, describing the system as it
stood at the end of Phase 9 (`v0.9.1`) without altering its behavior. See
[`docs/README.md`](../README.md) for the full documentation index this release produces.

## [v0.9.1] — Phase 9 complete - Enterprise Collaboration

Tag: `v0.9.1` (commit `09fbfa8`, 2026-07-21).

Enterprise Collaboration: presence, shared editing, comments and mentions, notifications, an inbox,
an activity feed, team spaces, shared AI conversations, and live dashboards — all organization-isolated
and built on the existing approval chain, agent framework, and Event Bus rather than parallel
infrastructure. Eight commits since `v0.9.0`:

- `412ddfb` — `feat(collaboration): add optimistic-locking version conflicts for Document/Project/Meeting`
  — the `version`/`EntityVersionSnapshot` shared-editing mechanism.
- `2fc10e2` — `feat(comments): add threaded comments with mentions`
- `f28f934` — `feat(spaces): add Team Spaces with content curation, not access control` — the explicit
  scope boundary named in its own commit subject; see
  [Architecture Decisions](../architecture/architecture-decisions.md).
- `880bf15` — `feat(shared-ai): add conversation sharing and ownership transfer` — introduced
  default-private `Conversation` access as real, in-scope behavior tightening, not a pre-existing
  guarantee.
- `8423829` — `feat(inbox): add notification inbox, activity feed, and live dashboard channel`
- `87de897` — `feat(collaboration): add Inbox, Activity Feed, Spaces, Team Dashboard, and Shared
  Conversations UI`
- `54049c9` — `feat(collaboration): wire comment threads and live presence into entity pages`
- `0a70630` — `fix(collaboration): adversarial security review findings` — a dedicated review pass
  that found and fixed two real issues; see [`testing/security.md`](../testing/security.md).
- `09fbfa8` — `feat(collaboration): add live notification bell to the topbar`

## [v0.9.0] — BOND OS foundation complete (P0-P9)

Tag: `v0.9.0` (commit `51cc3d7`, 2026-07-20).

The milestone marking Phases 0 through 9 as complete on the repository's current history, at the point
development moved to a fresh, non-OneDrive-synced clone (see
[Troubleshooting: OneDrive-synced project folders](../deployment/troubleshooting.md#onedrive-synced-project-folders)
for why). The commit itself (`51cc3d7`) reconciles the remote repository's initial README with the
local BOND OS history — an administrative merge, not a feature commit.

## Earlier history

`2b8b34c` (`Initial commit`) and `6695fd3` (`Initial BOND OS Platform`) are the two commits preceding
`v0.9.0` on this repository's history — the starting point this changelog's own record begins from.
Phases 0 through 8 (platform/auth/RBAC, the company database, the knowledge graph, AI memory/
retrieval, Mr. Bond, the Tool Execution Framework, the Multi-Agent Framework, and the Workflow
Automation Platform) were built before this changelog's granular per-commit record starts, and are
described architecturally throughout `docs/architecture/`, `docs/ai/`, `docs/agents/`, and
`docs/workflows/` rather than reconstructed here commit-by-commit.

## Related documents

- [`versioning.md`](./versioning.md) — what these version numbers actually mean (and where they
  diverge from `package.json`).
- [`release-process.md`](./release-process.md) — how a tag like the ones above actually gets created.
- [`checklist.md`](./checklist.md) — the verification gate every commit above passed before being
  pushed.
