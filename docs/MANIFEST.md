# Documentation Manifest

Complete file listing for the BOND OS Foundation Documentation Suite, generated in 10 independently
verified batches (see [`releases/changelog.md`](./releases/changelog.md) for the batch-by-batch commit
history) and tagged `v1.0.0` — "BOND OS Foundation Documentation Complete." Every file below was
either newly written or verified-and-kept against the real, current implementation during this suite's
generation. Line counts are exact as of the tagged commit; see `git log --oneline` for the batch commit
each directory was produced or verified in.

## Reorganized reference documentation (89 files, ~31,360 lines)

### docs/architecture/ (7 files)
- `docs/architecture/overview.md` — 168 lines
- `docs/architecture/system-architecture.md` — 398 lines (includes 4 embedded C4 diagrams: System Context/Container/Component/Code)
- `docs/architecture/request-flow.md` — 253 lines (includes 2 embedded sequence diagrams: `POST /api/tasks`, Bond RAG pipeline)
- `docs/architecture/folder-structure.md` — 165 lines
- `docs/architecture/design-principles.md` — 297 lines
- `docs/architecture/architecture-decisions.md` — 308 lines
- `docs/architecture/scalability.md` — 205 lines

### docs/database/ (4 files)
- `docs/database/erd.md` — 1,107 lines (10 `erDiagram` blocks, all 67 models / 46 enums)
- `docs/database/schema.md` — 1,908 lines
- `docs/database/relationships.md` — 422 lines
- `docs/database/migrations.md` — 220 lines

### docs/api/ (13 files)
- `docs/api/agents.md` — 903 lines
- `docs/api/ai.md` — 695 lines
- `docs/api/authentication.md` — 228 lines
- `docs/api/bond.md` — 612 lines
- `docs/api/collaboration.md` — 1,221 lines
- `docs/api/company-data.md` — 1,185 lines
- `docs/api/connectors-sync.md` — 16 lines (deliberately a short pointer to `system.md`, not duplicated content)
- `docs/api/graph.md` — 453 lines
- `docs/api/organizations.md` — 457 lines
- `docs/api/search.md` — 117 lines
- `docs/api/system.md` — 404 lines
- `docs/api/tools.md` — 823 lines
- `docs/api/workflows.md` — 934 lines

### docs/ai/ (10 files)
- `docs/ai/citations.md` — 310 lines
- `docs/ai/context-builder.md` — 294 lines
- `docs/ai/embeddings.md` — 476 lines
- `docs/ai/memory.md` — 280 lines
- `docs/ai/model-selection.md` — 253 lines
- `docs/ai/prompt-builder.md` — 315 lines
- `docs/ai/providers.md` — 364 lines
- `docs/ai/rag.md` — 511 lines
- `docs/ai/retrieval.md` — 332 lines
- `docs/ai/tool-calling.md` — 466 lines

### docs/knowledge/ (6 files)
- `docs/knowledge/entities.md` — 215 lines
- `docs/knowledge/extraction.md` — 188 lines
- `docs/knowledge/graph.md` — 275 lines
- `docs/knowledge/relationships.md` — 182 lines
- `docs/knowledge/resolution.md` — 139 lines
- `docs/knowledge/timeline.md` — 136 lines

### docs/workflows/ (8 files)
- `docs/workflows/overview.md` — 283 lines
- `docs/workflows/event-bus.md` — 358 lines
- `docs/workflows/scheduler.md` — 387 lines
- `docs/workflows/workflow-engine.md` — 514 lines
- `docs/workflows/builder.md` — 183 lines
- `docs/workflows/templates.md` — 309 lines
- `docs/workflows/retries.md` — 303 lines
- `docs/workflows/approvals.md` — 359 lines

### docs/agents/ (8 files)
- `docs/agents/overview.md` — 216 lines
- `docs/agents/base-agent.md` — 424 lines
- `docs/agents/registry.md` — 492 lines
- `docs/agents/routing.md` — 247 lines
- `docs/agents/delegation.md` — 512 lines
- `docs/agents/goals.md` — 397 lines
- `docs/agents/insights.md` — 359 lines
- `docs/agents/communication.md` — 358 lines

### docs/security/ (9 files)
- `docs/security/authentication.md` — 356 lines
- `docs/security/authorization.md` — 394 lines
- `docs/security/permissions.md` — 335 lines
- `docs/security/organization-isolation.md` — 377 lines
- `docs/security/audit.md` — 240 lines
- `docs/security/approvals.md` — 308 lines
- `docs/security/threat-model.md` — 479 lines
- `docs/security/prompt-injection.md` — 205 lines
- `docs/security/secrets.md` — 289 lines

### docs/deployment/ (8 files)
- `docs/deployment/local.md` — 199 lines
- `docs/deployment/production.md` — 215 lines
- `docs/deployment/docker.md` — 318 lines
- `docs/deployment/environment.md` — 182 lines
- `docs/deployment/github.md` — 171 lines
- `docs/deployment/backups.md` — 126 lines
- `docs/deployment/monitoring.md` — 146 lines
- `docs/deployment/troubleshooting.md` — 216 lines

### docs/development/ (6 files)
- `docs/development/setup.md` — 217 lines
- `docs/development/architecture.md` — 203 lines
- `docs/development/coding-standards.md` — 283 lines
- `docs/development/adding-features.md` — 383 lines
- `docs/development/debugging.md` — 204 lines
- `docs/development/git-workflow.md` — 144 lines

### docs/testing/ (6 files)
- `docs/testing/strategy.md` — 249 lines
- `docs/testing/unit.md` — 191 lines
- `docs/testing/integration.md` — 197 lines
- `docs/testing/e2e.md` — 138 lines
- `docs/testing/security.md` — 160 lines
- `docs/testing/performance.md` — 132 lines

### docs/releases/ (4 files)
- `docs/releases/changelog.md` — 89 lines
- `docs/releases/versioning.md` — 74 lines
- `docs/releases/release-process.md` — 117 lines
- `docs/releases/checklist.md` — 87 lines

## Project-level documents (3 files, ~750 lines)

- `README.md` — 296 lines — project overview, features by phase, installation, roadmap.
- `CONTRIBUTING.md` — 172 lines — repository standards, commit conventions, review checklist.
- `docs/README.md` — 282 lines — the documentation index (this suite's entry point).

## Phase-era deep-dive documentation (49 files, ~11,673 lines)

Pre-existing, written incrementally as each phase (P0–P9) was originally built, and confirmed still
accurate and linked from the reorganized docs above rather than superseded — see
[`docs/README.md`](./README.md#deep-dive-references-phase-era-docs) for the full grouped list
(`Architecture.md`, `FolderStructure.md`, `Setup.md`, and 46 more spanning the data layer, knowledge
graph, AI/retrieval, Mr. Bond, tool execution, multi-agent, workflow automation, and collaboration
subsystems).

## Grand total

**141 markdown files** (89 reorganized reference docs + 49 phase-era docs + `README.md` +
`CONTRIBUTING.md` + `docs/README.md`), approximately **43,780 lines**, covering every planned
directory from the original 10-batch specification with zero gaps.

## Verification summary

- **Internal links**: every `[text](path.md#anchor)`-style link across all 141 files resolves to a
  real file and a real heading-derived anchor — 0 broken links/anchors found in the final full-tree
  pass (several pre-existing broken anchors, found during this pass, were fixed — see
  [`releases/changelog.md`](./releases/changelog.md)).
- **Mermaid diagrams**: 74 diagrams across the suite (`erDiagram`, `sequenceDiagram`, `flowchart`/
  `graph`, `stateDiagram-v2`), all confirmed valid syntax.
- **Code verification gate**: `prisma validate`, `pnpm typecheck` (database/shared/web), `pnpm lint`
  (`--max-warnings 0`, database/shared/web), and `pnpm build` (`next build`, 123/123 static pages) all
  passed before every one of the 10 batch commits.

## Known documentation deviations and gaps

Stated plainly, matching this suite's own convention:

- **C4 and sequence diagrams are not standalone files.** The original plan named
  `architecture/c4-diagrams.md` and `architecture/sequence-diagrams.md` separately; Batch 1's actual
  file list only specified the 7 core architecture files, so the 4 C4 diagrams and 2 sequence diagrams
  were folded into `system-architecture.md` and `request-flow.md` respectively rather than split out.
  `docs/README.md` states this explicitly at the point it would otherwise have linked the two
  non-existent files.
- **Implementation/documentation mismatches found and documented** (in the relevant API docs
  themselves, not fixed in code — per this suite's "document the implementation" mandate):
  - `PATCH /api/user` and `PATCH /api/organization/[id]` both accept Zod-validated fields the route
    never actually persists (e.g. organization `description`/`website`/`industry`/`size` are validated
    but silently dropped) — see `docs/api/organizations.md`.
  - `GET /api/tasks/[id]` does not exist as a route despite `getTaskService` being defined in the
    service layer — see `docs/api/company-data.md`.
  - `WorkflowRunStep.loopIndex` is declared in the schema but never actually set by the `LOOP` step
    handler's real implementation — see `docs/workflows/workflow-engine.md`.
  - Several other real, code-verified gaps are named throughout the suite where found (e.g.
    `AgentRegistryStatus.DISABLED` declared but never set, `Task` missing the optimistic-locking
    `version` field present on Project/Document/Meeting) — each documented in place rather than
    collected separately, per this suite's file-scoped documentation convention.

## Related documents

- [`README.md`](../README.md) — the project overview this manifest supports.
- [`docs/README.md`](./README.md) — the navigable documentation index.
- [`releases/changelog.md`](./releases/changelog.md) — the batch-by-batch commit history that produced
  this manifest.
- [`releases/checklist.md`](./releases/checklist.md) — the verification checklist every batch passed.
