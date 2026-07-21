# Contributing to BOND OS

This document describes how work actually gets done in this repository, plus the process a new
external contributor should follow. Where those two differ (branching/PRs), both are stated explicitly
below — this file does not invent a workflow that isn't used internally just to look conventional.

## Repository Standards

- **Monorepo**: pnpm workspaces (`apps/*`, `packages/*`) + Turborepo. Install once at the repo root
  (`corepack pnpm install`); never `npm install`/`yarn` inside a package.
- **TypeScript everywhere.** No `any` beyond what already exists; new code should type-check cleanly
  under each workspace's own `tsc --noEmit`.
- **Every new mutating table/model** that is genuinely tenant-owned data must carry `organizationId`
  directly (not only reachable via a parent join) — see the "tenancy convention" section of
  `docs/database/schema.md` before adding a model.
- **Every service function** that touches organization data takes `organizationId`/calls
  `requireRole(organizationId, role)` first, before any repository call. This is a hard, repeatedly-
  enforced invariant across all 29 existing feature directories, not a style preference.
- **Every mutating API route** (`POST`/`PATCH`/`DELETE`) calls `assertSameOrigin(request)` before doing
  anything else, and is wrapped in `apiHandler()` so errors resolve through the shared `AppError`
  hierarchy and `ApiResponse<T>` envelope (`packages/shared/src/errors.ts`, `apps/web/lib/api-handler.ts`).
- **Never construct a class-based service directly** (`new XService(...)`) outside its
  `features/*/lib/container.ts`. If a feature's service is class-based, add its lazy `getX()` singleton
  there, following the existing `execution/lib/container.ts` → `agents/lib/container.ts` →
  `workflows/lib/container.ts` lineage.
- **Never import a concrete tool/agent/workflow-step-handler file directly** outside its registry
  (`features/tools/registry.ts`, `features/agents/registry.ts`, `features/workflows/registry.ts`).
  Register it there; every other call site resolves it through `registry.get()`/`.list()`.

## Branch Strategy

This repository has, to date, been developed **direct-to-main** with descriptive, single-purpose
commits — there is no `develop` branch, no long-lived feature branches, and (aside from one early
merge reconciling the initial README) no merge-commit history. `git log --oneline` for this repo is a
flat, linear sequence of commits on `main`.

**If you are an external contributor**, do not push directly to `main`. Follow the
[Pull Requests](#pull-requests) process below instead — branch from `main`, open a PR, and let a
maintainer merge it. This keeps the door open for review even though the project's own history so far
didn't need it (it was built by a single author/agent working incrementally with its own verification
discipline per commit — see [Review Checklist](#review-checklist)).

## Commit Conventions

Commits follow **Conventional Commits**: `type(scope): short, specific, present-tense description`.
Real examples from this repository's own history:

```
feat(collaboration): add live notification bell to the topbar
fix(collaboration): adversarial security review findings
feat(collaboration): wire comment threads and live presence into entity pages
feat(spaces): add Team Spaces with content curation, not access control
feat(comments): add threaded comments with mentions
feat(collaboration): add optimistic-locking version conflicts for Document/Project/Meeting
docs: <topic>            # (convention for documentation-only changes)
```

Guidelines drawn from the real history above:

- **`type`** is one of `feat`, `fix`, `docs`, `refactor`, `chore` — matching what a change actually is.
  Don't use `fix` for a new capability or `feat` for a pure bug fix.
- **`scope`** is a feature/domain name (`collaboration`, `spaces`, `comments`, `inbox`, `shared-ai`,
  `workflows`, `agents`, ...) — usually matching a directory under `apps/web/features/` or a clear
  cross-cutting concern.
- **Subject line** states what changed, specifically enough to be useful in `git log --oneline` alone —
  compare the real `feat(spaces): add Team Spaces with content curation, not access control` (states
  the design decision, not just "add spaces") to a vague `feat: update spaces`.
- **Body** (used consistently in this repo's own commits) explains *why*, calls out what was
  deliberately left unwired or deferred, and — critically — **states what verification was actually
  run**. Real example (`54049c9`): *"Verified: typecheck, lint, and a dev-server smoke test against all
  4 updated detail pages plus /api/presence and the SSE stream route."* Follow this pattern: a commit
  message that only describes the change and never states how it was checked is incomplete by this
  project's own standard.
- Every commit in this repository's history ends with a `Co-Authored-By:` trailer identifying the
  agent that helped produce it; keep that trailer if your workflow uses one, omit it if not applicable.

## Pull Requests

The process a new contributor should follow, even though this repository's own history has not
exercised it internally:

1. **Branch from `main`** using a short, descriptive name (e.g. `feat/workflow-retry-backoff`).
2. **Keep the PR scoped to one concern** — mirror the granularity of the real commit history above
   (one feature slice, one fix, one docs update) rather than bundling unrelated changes.
3. **Write the PR description like this project's own commit bodies**: what changed, what was
   deliberately left out or deferred (and why), and what you ran to verify it (see
   [Review Checklist](#review-checklist)).
4. **Run the full local verification pass before opening the PR** — see the checklist below. Do not
   rely on CI to catch what you didn't check yourself; there is currently no CI configured for this
   repository (no `.github/workflows` directory exists).
5. **Link or update the relevant doc(s)** under `docs/` in the same PR — see
   [Documentation Requirements](#documentation-requirements). A feature PR with no doc change is
   presumed incomplete unless the PR description explains why none was needed.
6. A maintainer reviews using the same [Review Checklist](#review-checklist) and merges once it passes.

## Review Checklist

Derived directly from the verification discipline this project's own commit history already
demonstrates (see the "Verified: ..." lines in commits like `54049c9`, `87de897`). Run all of these
before requesting review, and state which ones you ran in your PR description / commit body:

- [ ] **Schema validity** — `pnpm --filter @bond-os/database run validate` (`prisma validate`) if you
      touched `packages/database/prisma/schema.prisma`. This does not require a live database
      connection.
- [ ] **Type-check** — `pnpm typecheck` (fans out to every workspace via Turborepo).
- [ ] **Lint** — `pnpm lint` (`eslint . --max-warnings 0` per workspace — zero warnings allowed, not
      just zero errors).
- [ ] **Build** — `pnpm build`.
- [ ] **Dev-server smoke test** — run `pnpm dev`, actually visit every page/route your change touches,
      and hit the backing API route(s) directly. For an auth-gated page/route, confirm the expected
      redirect/401 behavior for an unauthenticated request, matching the existing pattern
      (`307` redirect on pages, `401` on APIs).
- [ ] **Regression spot-check** — for anything touching a shared primitive (the Event Bus, a registry,
      a container, the error hierarchy, CSRF, `requireRole`), manually re-check at least one existing
      caller still behaves correctly, not just the new one.
- [ ] **Org-isolation check** — for any new query, confirm it is scoped by `organizationId` (directly,
      or transitively through a parent that is). This project has previously run adversarial passes
      specifically for org-isolation, Space ACL boundaries, mention validation, and SSE-channel
      authorization (`0a70630`) — apply the same scrutiny to new surfaces that read or write
      cross-tenant-sensitive data.
- [ ] **Docs updated** — see below.

## Coding Style

Formatting is enforced by Prettier (`pnpm format` / `pnpm format:check`) and linting by ESLint
(`pnpm lint`, zero-warning policy) — both are configured centrally in `packages/config` and consumed by
every workspace. Full architectural and stylistic conventions (the repository→service→route→UI
layering, the composition-root pattern, the registry pattern, the `getPublishEvent()` dynamic-import
pattern, naming conventions) are documented in
**[docs/development/coding-standards.md](docs/development/coding-standards.md)** — read it before
adding a new feature directory, and follow the shape of an existing comparable feature (e.g. `tasks/`
for a plain-function CRUD service, `workflows/` for a class-based, container-wired service) rather than
inventing a new shape.

## Documentation Requirements

This suite was written incrementally, one doc per capability, as each phase was built — `docs/*.md`
is not an afterthought layer, it is treated as part of the feature. **Every new feature needs a doc**,
following the structure indexed at **[docs/README.md](docs/README.md)**:

- If your feature extends an existing documented subsystem (e.g. a new workflow step type, a new tool),
  update that subsystem's existing doc rather than creating a parallel one.
- If your feature is a genuinely new subsystem, add a new doc under the relevant `docs/` subdirectory
  (`docs/api/`, `docs/ai/`, `docs/workflows/`, `docs/agents/`, `docs/security/`, ...) and link it from
  `docs/README.md`.
- State scope and boundaries explicitly, the way every existing phase doc does — what the feature does
  AND what it deliberately does not do yet (see any `docs/*.md` file's "Scope" section for the pattern,
  e.g. `docs/workflows.md`, `docs/collaboration.md`). A doc that only describes happy-path behavior and
  is silent about known gaps does not meet this project's own bar.
- If you leave something unwired or deferred, say so in the doc, the way `docs/comments.md` documents
  `deleteCommentAttachment` being unwired and comment attachments not being cleaned up from storage on
  delete — a found-not-fixed gap, recorded rather than silently left undocumented.

## Testing Requirements

**Be honest about the current state**: this repository has **no automated test suite**. There is no
`test` script in any `package.json`, no test framework (Jest/Vitest/Playwright/etc.) in any
`devDependencies`, and no CI configuration (no `.github/workflows` directory) anywhere in the repo as of
this writing. Verification to date has been entirely manual, and recorded per-commit (see
[Review Checklist](#review-checklist) above, which mirrors this repo's own real practice).

Until a real automated suite exists:

- Treat the [Review Checklist](#review-checklist) above as the minimum bar for any change — it is not
  optional just because it isn't enforced by CI.
- If you add the first tests for a piece of this codebase, document the decision (framework choice,
  what's covered, what isn't) in **[docs/testing/strategy.md](docs/testing/strategy.md)** rather than
  adding test files silently — that doc is the intended home for "here is what our actual testing
  posture is," and it should stay as honest as this section is.
- Do not claim a change is "tested" in a commit message or PR description unless you mean "manually
  verified per the checklist above" — that is what this project's own commit history means by it, and
  overstating it would misrepresent the project's real coverage to the next contributor.
