# Coding Standards

These are the conventions actually enforced or actually followed in this codebase, verified against
`tsconfig.base.json`, `packages/config/eslint/base.mjs`, `.prettierrc.json`, and repeated patterns read
directly across `packages/database/src/repositories/*.ts`, `apps/web/features/*/services/*.service.ts`,
and `apps/web/app/api/**/route.ts`. Where a rule is genuinely just an observed convention rather than a
lint-enforced one, that's stated plainly below rather than implied to be machine-checked.

## TypeScript

`packages/config/tsconfig.base.json` (extended by every package/app):

```json
{
  "target": "ES2022",
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true,
  "isolatedModules": true,
  "verbatimModuleSyntax": false,
  "noEmit": true
}
```

- **`strict: true`** — full strict mode everywhere, no per-package opt-outs seen.
- **`noUncheckedIndexedAccess: true`** — indexing into an array/record gives you `T | undefined`, not
  `T`. This is why code like `organizations.find((org) => org.id === activeId) ?? organizations[0]!` in
  `apps/web/lib/organization.ts` needs the `!` — the array access is legitimately possibly-`undefined`
  under this flag even though the surrounding logic guarantees it isn't at that point.
- **`noImplicitOverride: true`** — a subclass method overriding a base method must say `override`.
- No `test`/`build` step per package for most of `packages/*` — Next.js transpiles workspace source
  directly (see [architecture.md](architecture.md#package-boundaries)); `tsc --noEmit` (the `typecheck`
  script) is purely a type-checking gate, not a build.

## Linting

`packages/config/eslint/base.mjs` (flat config, layered under `next/core-web-vitals` for `apps/web`):

```js
'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
'@typescript-eslint/no-explicit-any': 'warn',
'@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
'no-console': ['warn', { allow: ['warn', 'error'] }],
```

**Important nuance**: every package's `lint` script is `eslint . --max-warnings 0` (see
`packages/database/package.json`, `apps/web/package.json`). That means these `'warn'`-severity rules are
not advisory in practice — a single warning fails `pnpm lint` just as hard as an error would, because the
warning budget is zero. Read `'warn'` above as "still blocks lint," not "optional."

Practical consequences:

- **Type-only imports must use `import type`**, and mixed imports must inline the `type` keyword on the
  specific specifiers (`fixStyle: 'inline-type-imports'`) rather than a separate `import type { ... }`
  line — e.g. `import { ROLES, type CreateTaskInput } from '@bond-os/shared'`.
- **`any` is discouraged but not banned outright** (`'warn'`, not `'error'` — though the zero-warning
  budget makes the practical difference moot; you still need a reason to reach for `unknown` + a type
  guard instead).
- **Unused variables/args prefixed with `_` are allowed** — the standard escape hatch for intentionally
  unused destructured values or callback params.
- **`console.log` is disallowed; `console.warn`/`console.error` are allowed** — but the actual convention
  used throughout the app is the centralized `logger` (`packages/shared/src/logger.ts`), not `console.*`
  at all — see [debugging.md](debugging.md#logging).
- **No import-order ESLint rule is configured** (no `eslint-plugin-import`/`simple-import-sort` in
  `base.mjs`). The three-group import ordering described below is a strong, consistently-followed
  convention across the files read for this documentation — it is not machine-enforced, and Prettier will
  not reorder imports for you.

## Formatting

`.prettierrc.json`: `semi: true`, `singleQuote: true`, `trailingComma: "all"`, `printWidth: 100`,
`tabWidth: 2`, plus `prettier-plugin-tailwindcss` (sorts Tailwind classes; configured with
`tailwindFunctions: ["cn", "cva"]` so it also sorts classes passed through `cn()`/`cva()` calls, not just
literal `className` strings). Run `pnpm format` before committing; `pnpm format:check` is the read-only
equivalent.

## Import ordering

Three groups, separated by a blank line, seen consistently across every file read for this session:

```ts
// 1. External packages — @bond-os/* workspace packages and third-party npm packages
import { requireRole } from '@bond-os/auth';
import { prisma, type TaskDetail } from '@bond-os/database';
import { NotFoundError, ROLES, type CreateTaskInput } from '@bond-os/shared';

// 2. Internal app aliases — @/* (apps/web only; packages/* have no @/ alias)
import { createTaskService } from '@/features/tasks/services/task.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';

// 3. Relative imports — ../ and ./ (packages/database repositories, mostly)
import { prisma } from '../client';
import { userSummarySelect } from './shared';
```

Within a group, imports are alphabetized by package/path. In `'use client'` components, framework
packages (`react`, `next/navigation`, `react-hook-form`) commonly appear as their own leading group before
the `@bond-os/*` group — e.g. `apps/web/features/tasks/components/task-form-dialog.tsx` puts `react`,
`@hookform/resolvers/zod`, and `react-hook-form` first, then `@bond-os/database`/`@bond-os/shared`/
`@bond-os/ui`, then `next/navigation` inline with that same group, then a blank line, then `@/features/*`.
There is some real variance in exactly where a bare framework import lands relative to the `@bond-os/*`
group — the three-group shape (external → `@/*` → relative) is the part that holds consistently; treat the
exact framework-import placement as house style you can follow loosely, not a rule to chase precisely.

## Comments: explain WHY, not WHAT

The dominant comment style in this codebase is a doc comment that explains a **non-obvious reason**, not a
restatement of what the following line does. Representative examples, verbatim:

```ts
// apps/web/lib/csrf.ts
if (!origin) {
  // Same-origin requests issued by fetch() always send Origin for
  // state-changing methods; a missing header on a mutating request is
  // suspicious enough to reject outright.
  throw new ForbiddenError('Missing Origin header.');
}
```

```ts
// packages/database/src/repositories/tasks.ts
/**
 * Updates a task, scoped to `organizationId` via `updateMany` (Prisma's
 * unique-`update` can't combine `id` with a non-unique `organizationId`
 * filter). Document-link replacement only runs if the scoped update actually
 * matched a row, so a cross-tenant `id` can't sneak a document-list mutation
 * through even though the field update itself was a no-op.
 */
```

```ts
// apps/web/features/tasks/services/task.service.ts
/**
 * Dynamically imported at each call site below, not statically at the top
 * of this file — `publishEvent()` transitively reaches the Tool Registry
 * ... which imports THIS file's `createTaskService`. A static top-level
 * import here would be a real circular import...
 */
```

A short function that does exactly what its name says (`isAppError`, `roleSatisfies`) usually has **no**
comment at all. Write comments that answer "why is this written this way and not the obvious way,"
not "what does this line do" — a reader who knows TypeScript can already see what the line does.

## Layer responsibilities (repos return signals, services throw)

This is the load-bearing convention that makes the four-layer request path predictable:

- **Repositories** (`packages/database/src/repositories/*.ts`) return **signals**, never throw
  domain errors. `updateTask`/`updateProject` return `null` when the scoped row wasn't found;
  `deleteTask` returns `boolean` (`result.count > 0`); `listTasks` always returns a `PaginatedResult`,
  never throws for "no results." The one exception is a genuine invariant violation with no sensible
  caller-facing meaning — `createTask` throws a plain `Error` (not an `AppError`) if `getTaskById`
  can't find the row it just created, because that indicates actual data corruption, not a user-facing
  condition.
- **Services** (`features/*/services/*.service.ts`) are where `AppError` subclasses get thrown:
  `NotFoundError` when a repository signal comes back `null`/`false`, `ValidationError` for
  cross-entity invariants the database can't express (e.g. `assertAssigneeInOrg` — "Assignee must
  belong to your organization"), and `requireRole()` throwing `AuthError`/`ForbiddenError` internally
  before the repository is ever called.
- **Routes** (`app/api/**/route.ts`) don't throw at all in the success path — they parse input
  (`parseJsonBody`/`parseQueryParams`), call exactly one service method, and return `apiSuccess(...)`.
  Anything thrown anywhere in the chain is caught once, centrally, by `apiHandler()` — see
  [debugging.md](debugging.md#the-error-envelope) for the resulting JSON shape.

Every `AppError` subclass lives in one file, `packages/shared/src/errors.ts` — this is the complete,
exhaustive list, nothing else exists:

| Class | Status | Code |
| --- | --- | --- |
| `ValidationError` | 422 | `VALIDATION_ERROR` |
| `AuthError` | 401 | `AUTH_ERROR` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `RateLimitError` | 429 | `RATE_LIMITED` |
| `InternalError` | 500 | `INTERNAL_ERROR` |

Don't add a new subclass unless a genuinely new HTTP-status/code pairing is needed — `ConflictError` is
already reused as-is for optimistic-locking losses (`projects.ts`'s `updateProject`), not given a new
subclass, because 409/`CONFLICT` was already the right semantic.

## Organization scoping

Every tenant-owned table carries `organizationId` directly (no indirection through a join for the tenant
boundary itself). Because Prisma's unique-row `update`/`delete` can't combine a unique `id` with a
non-unique `organizationId` filter, **every scoped mutation uses `updateMany`/`deleteMany`** and checks
`result.count` instead:

```ts
const result = await prisma.task.deleteMany({ where: { id, organizationId } });
return result.count > 0;
```

This is not optional style — it's the only way a cross-tenant `id` guess can't silently mutate another
organization's row. Follow this exact shape for any new scoped mutation; see
[`../security/organization-isolation.md`](../security/organization-isolation.md) for the security framing.

## Migrations: additive-only

As of this writing there is a single migration on disk,
`packages/database/prisma/migrations/20260718000000_init/`, covering the full current schema (67 models /
46 enums) — generated offline (`prisma migrate diff --from-empty`) because the project was built in a
sandboxed environment with no live Postgres available (see [setup.md](setup.md#3-database)). There isn't
yet a multi-migration history to point to as evidence of the additive-only convention in migration-file
form — but the convention is demonstrated repeatedly at the code level, and any new migration should
follow it:

- New optional/defaulted columns, not required ones without a default, on existing tables in active use —
  e.g. `Project.version` (Phase 9 optimistic locking) is a plain `Int @default(0)`, and `updateProject`'s
  `expectedVersion` parameter is optional specifically so **every pre-Phase-9 caller, including the Tool
  Execution Framework's direct calls, keeps its exact prior last-write-wins behavior unchanged** — the
  repository's own doc comment says this explicitly.
- New tables added alongside, never replacing, existing ones when the domains are related but distinct —
  e.g. `KnowledgeDocument` (Phase 2 Knowledge Library) is a deliberately separate model from `Document`
  (Phase 1 project/meeting attachments), not a migration of one into the other; see
  [`../database/schema.md`](../database/schema.md) for why.
- New enum values are appended, not inserted/reordered — e.g. `EventSource`'s `COLLABORATION` value
  (Phase 9) was added to the existing enum, with its own `/// Phase 9 — ...` doc comment marking when and
  why, rather than the enum being redefined.

When you add a migration, run `pnpm db:migrate` (interactive `prisma migrate dev`, generates + applies
it) locally, and describe the new migration's intent in its own commit — see
[git-workflow.md](git-workflow.md). Full migration mechanics in
[`../database/migrations.md`](../database/migrations.md).

## Zod schema conventions

Input schemas live in `packages/shared/src/schemas/<feature>.ts`, one file per feature, barrel-exported
from `packages/shared/src/schemas/index.ts`. The recurring shape, verbatim from `schemas/task.ts`:

```ts
export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  status: taskStatusSchema.default('TODO'),
  projectId: z.string().min(1, 'A project is required.'),
  documentIds: z.array(z.string().min(1)).default([]),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema.partial();
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskQuerySchema = paginationQuerySchema.extend({
  status: taskStatusSchema.optional(),
  sortBy: z.enum([...]).default('createdAt'),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;
```

- **`updateXSchema` is always `createXSchema.partial()`** — never hand-duplicated.
- **`XQuerySchema` always extends the shared `paginationQuerySchema`** (`schemas/query.ts`) rather than
  redefining `page`/`pageSize`/`search`.
- **Every schema has an inferred type export** (`z.infer<typeof schema>`), named `Create<X>Input`/
  `Update<X>Input`/`<X>Query` — services and API routes import the type, never re-derive it.
- User-facing string fields get an explicit validation message (`'Title is required.'`); fields whose
  failure mode is "internal/programmer error" (an id that should always be present) don't bother.

## Naming conventions

- Repository files: plural, matching the Prisma model — `tasks.ts`, `projects.ts`, `workflow-runs.ts`.
- Service files: `<feature>.service.ts` (function style) or `<Feature>Service` class in the same file for
  the class style — e.g. `apps/web/features/workflows/services/workflow-run.service.ts` exports `class
  WorkflowRunService`. When a feature has two services with overlapping names for a deliberate reason
  (see `workflow-run.service.ts` vs. `workflow-run.query-service.ts` in
  [architecture.md](architecture.md)), the suffix disambiguates the split, not the model name.
  Corresponding exported function names get a `Service` suffix: `listTasksService`, `createTaskService`.
- Tool/agent/handler definition files: `<name>.tool.ts`, `<name>.agent.ts` — one concrete implementation
  per file, registered (never imported directly elsewhere) via the matching `registry.ts`.
- React component files: kebab-case matching the exported component name —
  `task-form-dialog.tsx` exports `TaskFormDialog`.
- `'use client'` is the first line of any client component file, with a blank line after it before
  imports.

## Further reading

- [architecture.md](architecture.md) — where each of these pieces lives.
- [adding-features.md](adding-features.md) — all of the above, applied end to end.
- [`../architecture/design-principles.md`](../architecture/design-principles.md) — the composition-root
  and registry patterns referenced above, in depth.
- [`../security/organization-isolation.md`](../security/organization-isolation.md) — the tenancy
  convention behind the `updateMany`/`deleteMany` rule.
