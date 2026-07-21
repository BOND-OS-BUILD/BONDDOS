# Release Checklist

## Scope

The concrete, run-by-hand checklist behind [`release-process.md`](./release-process.md)'s step 1 and
step 4 — what to actually check before a commit lands, and the additional items specific to cutting a
milestone tag. Every item here is either already enforced by this project's real practice (see
[`changelog.md`](./changelog.md) for the commits that passed it) or explicitly named as not yet
automated, matching this documentation set's convention of not implying a check exists where it
doesn't.

## Before every commit (not milestone-specific)

Identical to [`CONTRIBUTING.md`](../../CONTRIBUTING.md#review-checklist)'s own list — repeated here
because a milestone tag is only as trustworthy as the commits under it:

- [ ] **Schema validity** — `pnpm --filter @bond-os/database run validate` (`prisma validate`), if
      `packages/database/prisma/schema.prisma` changed.
- [ ] **Type-check** — `pnpm typecheck`.
- [ ] **Lint** — `pnpm lint` (zero-warning policy).
- [ ] **Build** — `pnpm build`.
- [ ] **Dev-server smoke test** — every page/route the change touches, including the unauthenticated
      `307`/`401` check.
- [ ] **Regression spot-check** — one existing caller of any shared primitive touched by the change.
- [ ] **Org-isolation check** — any new query is `organizationId`-scoped.
- [ ] **Docs updated** — see [`CONTRIBUTING.md`](../../CONTRIBUTING.md#documentation-requirements).

## Before cutting a milestone tag

Additional checks specific to the moment a phase or a defined body of work (like this documentation
suite) is declared complete — beyond what any single commit needs:

- [ ] **Every commit since the last tag individually passed the checklist above.** A milestone tag
      doesn't get its own separate verification pass distinct from its commits' — it's a statement
      that everything since the last tag is real and already checked, not a new gate.
- [ ] **`git rev-parse HEAD` equals `git rev-parse origin/main`** — local and remote agree before
      tagging; a tag created on an unpushed local commit is a real hazard (the tag can reference a
      commit hash the remote doesn't have yet).
- [ ] **The milestone's own stated scope is actually complete.** For this documentation suite
      specifically: every directory named in the original 10-batch plan exists on disk with its full
      file list (`docs/architecture/`, `docs/database/`, `docs/api/`, `docs/ai/`, `docs/knowledge/`,
      `docs/workflows/`, `docs/agents/`, `docs/security/`, `docs/deployment/`, `docs/development/`,
      `docs/testing/`, `docs/releases/`, plus `CONTRIBUTING.md`, `README.md`, `docs/README.md`) — see
      the final documentation manifest this suite's own completion step produces.
- [ ] **Internal links resolve.** Every `[text](path.md#anchor)`-style link across the changed
      documentation set points at a real file and a real heading-derived anchor — not just a file that
      exists, since a stale anchor (a heading renamed after the link was written) fails silently in a
      way a missing file doesn't.
- [ ] **Mermaid diagrams use valid syntax.** Every ` ```mermaid ` fenced block parses as one of this
      project's established diagram types (`flowchart`, `sequenceDiagram`, `erDiagram`,
      `stateDiagram-v2`) with matched brackets/quotes — a diagram that fails to render is a
      documentation defect exactly like a broken code sample.
- [ ] **No known implementation/documentation mismatch is left unstated.** If writing or verifying a
      doc surfaced a real gap between what the code does and what was previously documented (this
      suite found several — e.g. `PATCH /api/user`/`PATCH /api/organization/[id]` silently dropping
      validated fields, `GET /api/tasks/[id]` not existing as a route despite service-layer support —
      see [`docs/api/`](../api/) for the full, current statement of each), it must be stated in the
      relevant doc, not silently fixed-in-passing or left undocumented.
- [ ] **Tag message states what completed**, matching the existing two tags' style
      (`v0.9.0`: `BOND OS foundation complete (P0-P9)`; `v0.9.1`: `Phase 9 complete - Enterprise
      Collaboration`) — a short, human-readable description of the milestone, not just a version
      number.
- [ ] **Tag pushed and confirmed visible** — `git push origin vX.Y.Z`, then `git ls-remote --tags
      origin` to confirm it landed.

## What this checklist does not include (and why)

- **No automated CI check-run.** Every box above is checked by a human (or an agent acting as one)
  running the actual command and reading its output — there is no pipeline that runs this checklist
  automatically. See [`deployment/github.md`](../deployment/github.md).
- **No automated test-suite pass**, because none exists — see
  [`testing/strategy.md`](../testing/strategy.md). The dev-server smoke test and regression spot-check
  items above are this project's real substitute, and are explicitly manual.
- **No package-registry publish step**, because this project has never published a package — see
  [`versioning.md`](./versioning.md).
- **No staging-environment sign-off**, because no staging environment exists — see
  [Production](../deployment/production.md).

## Related documents

- [`release-process.md`](./release-process.md) — the end-to-end flow this checklist's items are drawn
  from.
- [`versioning.md`](./versioning.md) — what a tag created after this checklist passes actually means.
- [`changelog.md`](./changelog.md) — the record of every commit and tag that has passed this
  checklist so far.
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md#review-checklist) — the per-commit half of this checklist,
  stated once and referenced here rather than duplicated in full.
