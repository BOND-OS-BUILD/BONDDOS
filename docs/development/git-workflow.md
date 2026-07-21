# Git Workflow

This page describes the branch and commit conventions actually visible in this repository's real history
(12 commits on `main`, `git log` inspected directly for this documentation), plus the recommended
practice for new contributors going forward. For the canonical, maintained policy — PR process, review
checklist, coding/documentation/testing requirements — see **[`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)**;
this page focuses specifically on the git mechanics.

## The honest current state

This repository's history to date is **linear, single-branch commits directly to `main`**, all authored
by `BOND-OS-BUILD <harmansalgotra@foundbond.com>`:

```
09fbfa8 feat(collaboration): add live notification bell to the topbar
0a70630 fix(collaboration): adversarial security review findings
54049c9 feat(collaboration): wire comment threads and live presence into entity pages
87de897 feat(collaboration): add Inbox, Activity Feed, Spaces, Team Dashboard, and Shared Conversations UI
8423829 feat(inbox): add notification inbox, activity feed, and live dashboard channel
880bf15 feat(shared-ai): add conversation sharing and ownership transfer
f28f934 feat(spaces): add Team Spaces with content curation, not access control
2fc10e2 feat(comments): add threaded comments with mentions
412ddfb feat(collaboration): add optimistic-locking version conflicts for Document/Project/Meeting
51cc3d7 Merge remote initial README with local BOND OS history
2b8b34c Initial commit
6695fd3 Initial BOND OS Platform
```

`git branch -a` shows only `main` and `origin/main` — there is no feature-branch history, no merged PR
history, and no `.github/workflows` CI to gate anything, to point to as demonstrated practice. This
section says so plainly rather than describing a branching model as if it had been exercised. The sections
below are the recommended workflow for new contributors — consistent with how a monorepo like this should
be worked, and with the commit-message convention the existing history already follows closely — not a
retroactive description of multi-branch history that doesn't exist yet.

## Commit message convention

Every real commit past the initial two follows the same shape, and it's close enough to
[Conventional Commits](https://www.conventionalcommits.org/) to treat as that convention:

```
<type>(<scope>): <short imperative summary>

<body — one or more paragraphs, explaining WHY, not just what>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

- **Type**: only `feat` and `fix` actually appear in this repository's history (8 `feat`, 1 `fix`, plus
  two early non-conventional commits and one merge commit predating the convention). Conventional Commits'
  other standard types (`chore`, `docs`, `refactor`, `test`) are reasonable to use for work that's
  genuinely not a feature or a bug fix, but there's no example of them in this repo's actual history to
  point to.
- **Scope**: the feature or subsystem the change touches, matching a real directory name where possible
  — `collaboration`, `comments`, `spaces`, `shared-ai`, `inbox`. Lowercase, no punctuation beyond the
  parentheses.
- **Summary**: imperative mood ("add X", not "added X" or "adds X"), no trailing period, describes what
  changed at a glance.
- **Body**: this is the part actually worth imitating closely. Every real commit body in this repo's
  history explains **why** a decision was made, not just what files changed — and, distinctively, **calls
  out real gaps and limitations explicitly rather than glossing over them**. For example, commit
  `54049c9`'s body: *"Task and Entity/GRAPH_NODE are not wired — Tasks has no detail page in this codebase
  (list-only) and Entity has no edit/delete surface, the same two gaps already documented in
  docs/collaboration.md and docs/comments.md."* Or `f28f934`: *"Explicitly documented: SpaceMember never
  gates content visibility — every existing read path still checks organization role only. This is stated
  plainly in docs/spaces.md rather than left ambiguous..."* Write your own commit bodies the same way:
  state what you verified, and state what you deliberately left unfinished or ambiguous, rather than
  letting either go unsaid.
- **Verification line**: several commit bodies end with what was actually checked before the commit was
  made — e.g. `87de897`: *"Verified: typecheck, lint, and a dev-server smoke test against all 6 new pages
  plus their backing API routes (307 unauth redirect on pages, 401 on APIs, matching the existing
  pattern)."* Since there's no CI to enforce this, stating it in the commit body is the only record that
  it happened — do the same for your own commits. See [debugging.md](debugging.md#what-manual-verification-looks-like-today)
  for what this verification pass actually consists of today.
- **Trailer**: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` appears on every commit in this
  repository's history to date, reflecting how this codebase has actually been built. Include the
  equivalent trailer for whatever tooling actually produced a given change; omit it for changes you wrote
  yourself without AI assistance.

### A worked example, following the convention above

```
fix(tasks): prevent cross-tenant document links on a no-op status update

updateTask's transaction replaced TaskDocument links even when the
scoped updateMany matched zero rows (a cross-tenant id), because the
document-link branch didn't check the update's result.count first.
Fixed by gating it on the same result the field-update branch already
checks — no cross-tenant id can now attach/detach documents through
this path.

Verified: typecheck, lint, and a manual repro against two orgs
confirming the cross-tenant id no longer mutates TaskDocument rows.
```

## Branching (recommended, not yet exercised in this repo's history)

For new work, branch off `main`:

```bash
git checkout -b feat/<short-description>
```

Name branches the same way commit scopes are named — lowercase, hyphenated, matching the feature
directory when there is one (`feat/invoices`, `fix/task-document-link-scoping`). Keep a branch focused on
one feature/fix, matching how the real commit history is already organized (each commit is one coherent
vertical slice — e.g. `2fc10e2` adds the entire comments feature: models, mentions, notification
fan-out, and wiring into five existing delete services, in one commit).

## Before you commit

Since there is no CI, this is the actual gate — see [debugging.md](debugging.md#what-manual-verification-looks-like-today)
for detail:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Plus a manual smoke test of whatever surface you changed (`pnpm dev`, exercise the change in the browser
or against the API directly). For anything touching authorization, organization-scoping, or a new SSE
channel, do the kind of adversarial pass commit `0a70630` records: walk every new/changed table's
org-isolation, re-check who can reach a new endpoint, and re-verify any doc-comment claim about behavior
against the actual code rather than trusting the comment.

## Pull requests

If you're using GitHub (`origin` is `https://github.com/BOND-OS-BUILD/BONDDOS.git`), open a PR from your
branch into `main` via `gh pr create` or the GitHub UI. There is no PR template, no required-reviewers
rule, and no status checks configured on this repository as of this writing (no `.github/` directory at
all) — so a PR here is a review/discussion mechanism, not a gate enforced by tooling. See
[`../deployment/github.md`](../deployment/github.md) for the current state of GitHub-side configuration,
and [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) for the review checklist this project expects a human
reviewer to apply manually in that PR.

## Further reading

- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — repository standards, the full review checklist,
  and documentation/testing requirements for new work.
- [debugging.md](debugging.md) — what "verified" means in a commit body, in practice.
- [`../testing/strategy.md`](../testing/strategy.md) — the honest current testing posture and what a real
  suite would need to cover.
- [`../releases/release-process.md`](../releases/release-process.md) — how a release is cut from `main`.
