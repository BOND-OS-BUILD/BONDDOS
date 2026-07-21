# Troubleshooting

## Scope

Real, encountered-or-directly-verified issues an operator or contributor is likely to hit running
BOND OS locally or in a first production deploy, each with the actual root cause and fix — not a
generic troubleshooting checklist. Every issue here is cross-referenced from the other deployment docs
that name it as a gap or a gotcha; this page is where the detail lives.

## Windows `next build` EPERM symlink error

**Symptom:** `pnpm build` (or `next build` directly) compiles successfully, prints
`✓ Compiled successfully`, generates every static page (`✓ Generating static pages (123/123)`), and
then fails during the final `Collecting build traces` step with output like:

```
⚠ Failed to copy traced files for .next\server\pages\_app.js [Error: EPERM: operation not permitted, symlink
'C:\...\node_modules\.pnpm\react@19.2.7\node_modules\react' -> 'C:\...\.next\standalone\...\node_modules\react'] {
  errno: -4048,
  code: 'EPERM',
  syscall: 'symlink',
  ...
}

> Build error occurred
[Error: EPERM: operation not permitted, symlink ...]
```

**Root cause:** `next.config.ts` sets `output: 'standalone'` (see
[Production](./production.md#building-for-production-without-docker)), and Next's standalone-output
step assembles a self-contained `node_modules` tree for the traced server bundle by creating
filesystem symlinks back into pnpm's content-addressed store. Creating a symlink on Windows requires
`SeCreateSymbolicLinkPrivilege` — a privilege that, by default, only accounts running as Administrator
(or with Developer Mode enabled and the privilege explicitly granted) hold. A standard Windows user
account has every other part of the build succeed — TypeScript compiles, every route and page renders,
the app is fully correct — and only fails at this one trace-copying step, which is filesystem
plumbing unrelated to whether the code itself is correct.

**This is not a code defect, a regression from any change in this repository, or specific to any one
package version** — it reproduces identically on a clean checkout with no source changes at all, purely
as a function of the Windows account's privilege level.

**Fixes, in order of practicality:**

1. **Build inside the Docker image instead** (`docker build -t bond-os .` or
   `docker compose --profile full up -d --build`) — the `Dockerfile`'s build stage runs on Linux inside
   the container, where this privilege restriction doesn't exist. This is the actually-used path for
   producing a real deployable artifact from a Windows development machine; see [Docker](./docker.md).
2. **Run the build with Administrator privileges** (an elevated terminal), if a native Windows build
   artifact is specifically needed outside Docker.
3. **Grant the account `SeCreateSymbolicLinkPrivilege` directly** via Local Security Policy
   (`secpol.msc` → Local Policies → User Rights Assignment → "Create symbolic links") or enable
   Developer Mode in Windows Settings, which grants it to standard accounts for the current session.
4. **Accept the partial build for local development purposes.** `next dev` never hits this code path
   at all — the standalone-output trace-copy step only runs for `next build`. Everyday local
   development (`pnpm dev`) is completely unaffected; this only blocks producing a standalone
   production artifact directly on Windows.

## pgvector extension missing

**Symptom:** `pnpm db:migrate` / `pnpm db:migrate:deploy` fails against the bundled
`docker-compose.yml` Postgres service with an error on:

```sql
CREATE EXTENSION IF NOT EXISTS "vector";
```

**Root cause:** `packages/database/prisma/schema.prisma` declares `extensions = [vector]` and the
`embeddings` table stores an `Unsupported("vector(1536)")` pgvector column — real, load-bearing
functionality for the [RAG pipeline](../ai/rag.md) and [retrieval](../ai/retrieval.md), not optional
schema decoration. `docker-compose.yml`'s `postgres` service, however, uses the **vanilla**
`postgres:16-alpine` image, and the official Postgres Docker images (any tag, Alpine or Debian) do not
ship pgvector pre-installed. There is no init script, custom Dockerfile, or `apk add` step anywhere in
this repository's Compose configuration that installs the extension. See
[Docker: pgvector — a real gotcha](./docker.md#pgvector--a-real-gotcha) for the full detail on why this
is a genuine configuration gap in the bundled file, verified directly against the migration SQL and the
exact image tag.

**Fixes:**

1. **Swap the `postgres` service's image** in `docker-compose.yml` to a pgvector-enabled variant, e.g.
   `pgvector/pgvector:pg16` (a drop-in replacement maintained by the pgvector project that ships the
   extension pre-built) — the simplest fix for local development.
2. **Use a hosted Postgres provider that supports pgvector** (Supabase and Neon both do, out of the
   box) instead of the bundled Compose service — see
   [Local Development: Database](./local.md#3-database), Option B.
3. **Install the extension into the existing image yourself** — build a custom image layer that
   compiles/installs `pgvector` on top of `postgres:16-alpine`, if there's a specific reason to keep
   the exact base image.

Whichever fix is applied, `CREATE EXTENSION IF NOT EXISTS "vector"` only needs to succeed once per
database — it's the first statement in the one init migration
(`packages/database/prisma/migrations/20260718000000_init/migration.sql`).

## `NODE_ENV` set in `.env` breaks the production build

**Symptom:** A production build (`next build`/`next start`, or the Docker image's build stage) either
prints a Next.js warning about a "non-standard `NODE_ENV` value," or fails outright with an error
originating from `pino-pretty` trying to spin up mid-build.

**Root cause:** Node/Next.js set `NODE_ENV` contextually — `development` for `next dev`, `production`
for `next build`/`next start` — and `.env.example`'s own comment states this explicitly: `NODE_ENV` is
deliberately **not** listed there. If a developer's local `.env` file sets `NODE_ENV=development`
anyway (e.g. copied from another project's template, or added out of habit) and that `.env` is present
during what should be a production build, the explicit value **overrides** Next's own contextual
setting. `packages/shared/src/logger.ts` only enables pino's `pino-pretty` transport (a worker-thread-
based pretty-printer) when `NODE_ENV !== 'production'` — so a stale `development` value present during
a production build makes the logger try to spin up that transport mid-build, which fails, since
`pino-pretty` is a devDependency not guaranteed to be available in a production install context. See
[Environment Variables: `NODE_ENV`](./environment.md#node_env) for the full mechanism.

**Fix:** Remove any explicit `NODE_ENV` line from `.env` (and from any `.env.production`/`.env.local`
variant). Let Node/Next set it contextually. The one legitimate exception in this codebase is the
`Dockerfile`'s `runner` stage, which sets it via a Docker `ENV NODE_ENV=production` instruction
(container environment, not a tracked `.env` file) — see
[Docker: Stage 4 — runner](./docker.md#stage-4--runner).

## No live Postgres in some dev sandboxes

**Symptom:** Running `pnpm db:migrate` for the first time against a real Postgres instance behaves
like a genuinely first-time operation — unexpected prompts, or an error that doesn't obviously match
anything already reported for this codebase.

**Root cause:** Per `docs/Setup.md` (the phase-era source [Local Development](./local.md) reorganizes),
this repository was originally built in a sandboxed development environment with **no live Postgres
instance available at all**. The one migration on disk
(`packages/database/prisma/migrations/20260718000000_init/`, covering the full 67-model/46-enum
schema) was generated **offline** — via `prisma migrate diff --from-empty --to-schema-datamodel`
against the schema file directly, never against a running database — and validated only with
`prisma validate` (a schema-only, no-connection check). It was never actually applied to a live
database by this project's own build/development process before an operator does so for the first
time.

**What this means in practice:** running `docker compose up -d postgres` followed by `pnpm db:migrate`
against your own Postgres really is the first real application of this migration anywhere. If it
succeeds cleanly (the expected outcome — the migration SQL is straightforward, hand-verified DDL), this
note is just context for why the repository's own history has no "ran the initial migration" commit
against a live database. If it fails in a way that looks like a schema-authoring bug rather than an
environment issue (a genuinely malformed `CREATE TABLE`/`CREATE INDEX` statement, as opposed to a
missing extension — see [pgvector extension missing](#pgvector-extension-missing) above, the one known
category of first-run failure), that is plausibly a real defect worth reporting rather than user error,
precisely because no prior run has exercised this path to catch it.

## OneDrive-synced project folders

**Symptom:** Files in the project directory disappear or get corrupted without any explicit delete —
most visibly as `git status` showing files as deleted that were never intentionally removed, or a build
failing because a file that should exist is simply gone from disk.

**Root cause:** Windows' OneDrive Desktop/Documents folder sync (or any similar continuous-sync cloud
storage client — Dropbox, Google Drive's equivalent) actively manages files inside any folder it syncs,
including reconciling, moving to an online-only placeholder state, or in some observed cases deleting
files it perceives as conflicting or stale — behavior that fights directly with a build toolchain
(`node_modules`, `.next`, `.turbo`, Prisma's generated client) that creates, deletes, and rewrites
thousands of files per build. A `node_modules` tree alone routinely contains far more files than a
typical sync client is tuned to handle smoothly, and the combination of a live sync client and an
active pnpm/Next.js/Turborepo build process operating on the same directory tree is a genuine source of
file loss, confirmed directly during this project's own development history.

**Fix:** Do development work in a path **outside** any OneDrive/Dropbox/cloud-sync-managed folder
entirely — e.g. `C:\dev\<project>` rather than `C:\Users\<you>\OneDrive\Desktop\<project>`. This isn't
a configuration flag to toggle; it's a choice of which directory the repository lives in. If a project
was started inside a synced folder and hits this problem, the fix is to clone the repository fresh into
a non-synced path rather than attempting to move or repair the existing, possibly-already-corrupted
tree in place.

## `env.ts` validation errors on boot

**Symptom:** The app fails to start (dev or production) with a formatted error like:

```
❌ Invalid environment variables:
  - DATABASE_URL: Required

Check your .env file against .env.example.
```

**Root cause:** `packages/shared/src/env.ts`'s `loadEnv()` runs a zod schema over `process.env` lazily,
on the first `getEnv()` call, and throws this formatted, per-field error listing every missing or
invalid required variable at once (not just the first one hit) rather than failing individually and
repeatedly. This is deliberate fail-fast behavior — see [Environment Variables](./environment.md) for
the full variable-by-variable reference.

**Fix:** `cp .env.example .env` if that step was skipped, then fill in whichever fields the error names.
The error message itself lists every problem in one pass, so there's no need to fix one variable, rerun,
and discover the next missing one — read the whole list before editing `.env` once.

## `403 Cross-origin request rejected` on every mutating request

**Symptom:** Pages load and reads work normally, but every `POST`/`PATCH`/`DELETE` request — including
sign-in itself in some misconfigurations — fails with a `403` and the message
`Cross-origin request rejected`.

**Root cause:** `APP_URL`/`NEXT_PUBLIC_APP_URL` doesn't exactly match the origin (scheme + host + port)
the app is actually being accessed from. `apps/web/lib/csrf.ts`'s `assertSameOrigin()` compares the
incoming request's `Origin` header against `new URL(getEnv().APP_URL).origin` on every mutating route,
and Better Auth's own `trustedOrigins: [env.APP_URL]` enforces the same match for its endpoints. See
[Production: `APP_URL` correctness](./production.md#app_url-correctness-the-csrfbetter-auth-trap) for
the full mechanism — this is called out there as "the single easiest thing to get wrong in a first
production deploy" because the failure mode (app looks up, reads work, writes silently 403) is easy to
mistake for a partial outage rather than a one-line config mismatch.

**Fix:** Set `APP_URL` and `NEXT_PUBLIC_APP_URL` to the exact, real origin the app is served from —
correct scheme (`https://` in production), correct host, correct port if non-default, no trailing
slash. Locally, this is `http://localhost:3000` unless the dev server is configured to run on a
different port.

## Related documents

- [Production](./production.md) — the pre-deploy checklist several of these issues are named in.
- [Docker](./docker.md) — the pgvector and no-healthcheck gotchas in full container context.
- [Local Development](./local.md) — where the sandboxed-migration and `NODE_ENV` notes are first
  introduced.
- [Environment Variables](./environment.md) — every variable `env.ts` validates, and the two escape
  hatches (`LOG_LEVEL`, `NODE_ENV`) that live outside that validation.
- [Monitoring](./monitoring.md) — reading pino's JSON output when a symptom isn't covered here.
