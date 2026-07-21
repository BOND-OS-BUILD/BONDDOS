# Unit Testing

## Current coverage: none

There are no unit tests anywhere in this repository. A search for `*.test.*`/`*.spec.*` files
outside `node_modules`, and a search of every `package.json` in the workspace for `vitest`, `jest`,
or `@testing-library/*`, both returned nothing. See [`strategy.md`](./strategy.md) for the
repository-wide statement this document inherits.

## What runs today instead: type-checking, not testing

The closest thing to automated per-function verification BOND OS has today is `pnpm typecheck`
(`turbo run typecheck`, which fans out to `tsc --noEmit` in every workspace — `apps/web` and all nine
`packages/*`). This is a **correctness gate, not a test**: it confirms every function's inputs and
outputs satisfy their declared types under TypeScript's `strict: true` +
`noUncheckedIndexedAccess: true` compiler options (`packages/config/tsconfig.base.json`), but it
proves nothing about whether a function's logic is *right*. A function typed
`(text: string) => TextMatch[]` that returns an empty array for every input still type-checks
perfectly.

```bash
pnpm typecheck                                              # every workspace, via Turborepo
pnpm --filter @bond-os/extraction run typecheck              # one workspace only
```

`pnpm lint` (`eslint . --max-warnings 0` per workspace, shared config at
`packages/config/eslint/base.mjs`) is the other half of today's gate — it catches unused variables,
`any` leakage, inconsistent type-only imports, and stray `console.log` calls, again with zero
behavioral coverage.

Until a real unit-test framework exists, correctness at the function level is verified the way
[`strategy.md`](./strategy.md) describes for the whole codebase: manually, by the person making the
change, as part of the dev-server smoke test — not by an isolated, repeatable, per-function check.

## What unit testing would mean in this codebase

BOND OS is architecturally service-heavy: most interesting behavior only means something once a
repository call, a service method, and (often) an `organizationId` are all involved — that class of
behavior belongs to [`integration.md`](./integration.md), not here. What genuinely qualifies as
**pure, dependency-free unit-test material** is smaller, but real, and concentrated in a few
packages:

### `packages/extraction` — regex/heuristic entity-candidate extraction

Confirmed by direct reading, `packages/extraction/src/regex.ts` exports pure functions with no I/O:

```ts
export function extractEmails(text: string): TextMatch[]
export function extractUrls(text: string): TextMatch[]
export function extractPhones(text: string): TextMatch[]
export function extractFileReferences(text: string): TextMatch[]
```

plus date-pattern matching over `EMAIL_PATTERN`, `URL_PATTERN`, `PHONE_PATTERN`,
`FILE_REFERENCE_PATTERN`, and four `DATE_PATTERNS` regexes (ISO, US, "Month D, YYYY", "D Month
YYYY"). `packages/extraction/src/companies.ts` and `names.ts` round out the candidate-extraction
surface. This is explicitly regex/heuristic, by design — [`README.md`](../../README.md)'s Roadmap
states plainly that `@bond-os/extraction` is "regex/heuristic only, by explicit design," with no
AI-based extraction. That makes it unusually good unit-test material: deterministic input → output,
no mocking required, and the kind of code where a regex edge case (an email with a `+` alias, a
phone number with an extension, a date crossing a month boundary) is exactly the class of bug a table
of input/expected-output cases would catch cheaply. See
[Entity Extraction](../knowledge/extraction.md) for the feature this package backs.

### `packages/parsers` — hashing and chunking

- `packages/parsers/src/hash.ts` — `hashContent(content: string): string`, a one-line SHA-256 digest
  used by `Chunk.contentHash` for re-sync change detection, and reused (per
  [Approval Security](../security/approvals.md)) as the primitive behind `planHash` plan-integrity
  verification. A pure function with an easy property to assert: same input → same hash, different
  input → (almost certainly) different hash.
- `packages/parsers/src/chunking.ts` — text-chunking logic for the document pipeline. Deterministic
  given a fixed input and chunk-size configuration.

### `packages/shared` — cross-cutting pure logic

- `packages/shared/src/errors.ts` — the `AppError` hierarchy (`ValidationError` → 422, `AuthError` →
  401, `ForbiddenError` → 403, `NotFoundError` → 404, `ConflictError` → 409, `RateLimitError` → 429,
  `InternalError` → 500) and `isAppError()`. Each subclass's `statusCode`/`code` pairing is a fact
  worth locking down with a unit test — this exact mapping is what
  `apps/web/lib/api-handler.ts`'s `toErrorResponse` depends on for every single API route in the
  application (see [`integration.md`](./integration.md) for testing that consumer).
- `packages/shared/src/constants.ts` — `ROLE_HIERARCHY` (`{ OWNER: 3, ADMIN: 2, MEMBER: 1 }`) and
  `roleSatisfies(role, required)`. This one function is the single comparison used everywhere a role
  check happens across the entire codebase — `requireRole`, `ApprovalService.approve`,
  `PermissionService.requiredRoleForTools`, and per-hop delegation checks (see
  [Threat Model → Privilege escalation](../security/threat-model.md#privilege-escalation)). A
  three-value truth table (`OWNER`/`ADMIN`/`MEMBER` × `OWNER`/`ADMIN`/`MEMBER`) is the entire test
  surface, and given how many security-relevant call sites depend on it, it is one of the
  highest-leverage-per-line-of-test-code candidates in the repository.
- `packages/shared/src/rate-limit.ts` — `InMemoryRateLimiter.consume()`'s fixed-window logic
  (allow under limit, reject at limit, reset after window) is pure enough to unit test with a mocked
  clock, though its interaction with `withRateLimit` and real request timing is arguably an
  integration concern — see [`performance.md`](./performance.md) for the capacity implications of
  this being single-instance/in-memory.
- Every `packages/shared/src/schemas/*.ts` Zod schema (e.g. `paginationQuerySchema` in
  `schemas/query.ts`, capping `pageSize` at 100) — schema `.parse()`/`.safeParse()` behavior on
  valid and invalid input is deterministic and dependency-free.

### `packages/embeddings` — provider selection, not provider calls

`packages/embeddings/src/registry.ts` and `base-provider.ts` define the pluggable-provider
abstraction (OpenAI/Gemini/Voyage/Ollama/local fallback — see
[Embeddings](../ai/embeddings.md)). The *selection logic* (which provider gets chosen given
configuration) is unit-testable in isolation; the providers' actual HTTP calls to external APIs are
not — those belong in integration tests with the provider mocked out, or are excluded from automated
coverage entirely as external-dependency calls.

### What does *not* belong at this layer

- **Anything that imports `@prisma/client` or calls a repository function** — even read-only calls
  need a real (or realistically faked) database to mean anything; that's
  [`integration.md`](./integration.md) territory.
- **Next.js Route Handlers** (`apps/web/app/api/**/route.ts`) — these compose `apiHandler`,
  `requireRole`, CSRF checks, and a service call; testing them in isolation from their dependencies
  would mostly test that the mocks were wired correctly, not that the route works. Test them as
  integration tests instead (see [`integration.md`](./integration.md)).
- **Anything behind a feature's `container.ts` lazy singleton** (e.g.
  `apps/web/features/execution/lib/container.ts`,
  `apps/web/features/workflows/lib/container.ts`,
  `apps/web/features/agents/lib/container.ts`) — these compose multiple services together by
  design; unit-testing the composition itself has little value, but the individual class methods a
  container wires up (with their dependencies faked) are reasonable **service-level unit tests**, a
  middle ground covered further in [`integration.md`](./integration.md).

## How to run what exists today

There is no `pnpm test` command. The only runnable, automated checks at this granularity are the
correctness gates already covered in [`strategy.md`](./strategy.md):

```bash
pnpm typecheck    # tsc --noEmit, every workspace
pnpm lint         # eslint --max-warnings 0, every workspace
```

## Roadmap: adding real unit tests

**Framework: [Vitest](https://vitest.dev/).** See [`strategy.md`](./strategy.md#recommended-framework-choices-and-why)
for the full reasoning; in short, it matches this codebase's native-ESM, TypeScript-first,
Turborepo-orchestrated setup without adding a transpilation layer.

A first unit-test slice, in priority order, would look like:

1. `packages/shared/src/constants.ts` — `roleSatisfies` truth table (9 cases: 3 roles × 3 required
   levels).
2. `packages/shared/src/errors.ts` — every `AppError` subclass's `statusCode`/`code` pairing.
3. `packages/parsers/src/hash.ts` — `hashContent` determinism and sensitivity to input change.
4. `packages/extraction/src/regex.ts` — a table of representative inputs per extractor (valid email
   variants, malformed ones that should *not* match, phone numbers in each documented format, dates
   in each of the four supported formats).
5. `packages/shared/src/schemas/*.ts` — valid/invalid cases for the higher-traffic schemas
   (`paginationQuerySchema`, the execution/workflow schemas).

A sketched (not yet real) per-package config would follow the same one-script-per-workspace shape
`lint`/`typecheck` already use:

```jsonc
// packages/extraction/package.json — illustrative, not present in the repo today
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^2.x"
  }
}
```

```jsonc
// turbo.json — illustrative addition
{
  "tasks": {
    "test": { "dependsOn": ["^generate"], "outputs": [] }
  }
}
```

No coverage thresholds, coverage tooling, or specific test counts are claimed here — none exist yet,
and inventing numbers would violate this documentation set's own standard of only describing what was
actually verified. See [`strategy.md`](./strategy.md) for how this layer fits into the overall
pyramid.

## Related documents

- [`strategy.md`](./strategy.md) — the overall testing posture and pyramid this document's layer
  fits into.
- [`integration.md`](./integration.md) — where repository-, service-, and route-level behavior
  (everything excluded above) would be tested instead.
- [Entity Extraction](../knowledge/extraction.md) — the feature `packages/extraction` backs.
- [Embeddings](../ai/embeddings.md) — the pluggable provider abstraction in `packages/embeddings`.
- [Approval Security](../security/approvals.md) — where `hashContent` reappears as `planHash`.
