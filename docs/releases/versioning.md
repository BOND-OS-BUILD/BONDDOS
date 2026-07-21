# Versioning

## Scope

What version numbers actually mean in this repository today, stated precisely — including where the
scheme is inconsistent with itself, because that inconsistency is real and worth naming rather than
smoothing over.

## The real scheme: milestone-tagged, not strict semver

BOND OS is versioned by **annotated git tags at milestone commits**, each with a descriptive message
naming what completed — `v0.9.0` (`BOND OS foundation complete (P0-P9)`), `v0.9.1` (`Phase 9 complete -
Enterprise Collaboration`), and `v1.0.0` (`BOND OS Foundation Documentation Complete`). This is closer
to a **phase/milestone marker** than to [Semantic Versioning](https://semver.org/)'s
contract-stability meaning (MAJOR = breaking API change, MINOR = backward-compatible feature, PATCH =
backward-compatible fix) — there is no published package, npm registry entry, or external API contract
whose stability these numbers are actually promising anything about. The number after `v` tracks
**how much of the platform is built and documented**, not a compatibility guarantee to any consumer.

## `package.json` does not track the tag version

Confirmed directly: every `package.json` in the monorepo (root and `apps/web`) declares
`"version": "0.1.0"` — the default a scaffolding tool leaves behind — and has never been bumped to
match any of the `v0.9.0`/`v0.9.1`/`v1.0.0` git tags. This is a real, existing mismatch, not a
documentation gap:

| Where | Value | Meaning |
| --- | --- | --- |
| `package.json` (root, `apps/web`) | `0.1.0` | Never updated since scaffolding — not load-bearing anywhere in the codebase (nothing reads it to gate behavior) |
| Git tags | `v0.9.0`, `v0.9.1`, `v1.0.0` | The actual milestone record this project uses day to day |

Nothing in the application reads `package.json`'s `version` field to make a decision (no version-gated
feature flag, no "you're running an outdated version" check) — it is inert metadata today. A future
contributor bumping it to match the tag scheme (e.g. `1.0.0` alongside the `v1.0.0` tag) would be a
reasonable cleanup, but as of this writing it has not been done, and this document states that plainly
rather than implying the two are already in sync.

## What would change under real semver, if adopted

If this project moves toward publishing packages (any of the 10 workspace packages under `packages/`
becoming independently consumable) or exposing a versioned public API contract, real semver would
start to matter in a way it doesn't yet:

- **MAJOR** would need to mean an actual breaking change to a published interface — today, "breaking"
  in this codebase means a Prisma schema change that isn't additive (see
  [Coding Standards: Migrations — additive-only](../development/coding-standards.md#migrations-additive-only)),
  which is an internal-database-schema concern, not a public API contract.
- **MINOR**/**PATCH** would map reasonably well to the existing `feat`/`fix` Conventional Commits
  scopes this project already uses (see
  [`CONTRIBUTING.md`](../../CONTRIBUTING.md#commit-conventions)) — the commit-message discipline is
  already semver-adjacent even though the tag numbers aren't derived from it today.

This section is explicitly aspirational — nothing described here is implemented; see
[`release-process.md`](./release-process.md) for what tagging actually involves today.

## Tag naming convention

Every tag so far follows `vX.Y.Z` with an annotated message stating what completed, created via:

```bash
git tag -a vX.Y.Z -m "<what completed>"
git push origin vX.Y.Z
```

`git tag -l -n99` lists all tags with their full messages — the authoritative source for this
project's release history, cross-referenced in [`changelog.md`](./changelog.md).

## Related documents

- [`changelog.md`](./changelog.md) — every tagged milestone and the commits under it.
- [`release-process.md`](./release-process.md) — the actual steps behind creating one of these tags.
- [`checklist.md`](./checklist.md) — what must pass before a milestone commit is tagged.
- [Coding Standards: Migrations — additive-only](../development/coding-standards.md#migrations-additive-only)
  — the closest thing this codebase has to a "breaking change" concept today.
