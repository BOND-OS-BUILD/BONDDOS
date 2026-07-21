# Local Development

## Scope

How to get BOND OS running on a local machine — the actual sequence, using the actual scripts in the
actual `package.json` files, not an idealized one. This is the deployment suite's version of that
walkthrough, framed around "local machine as a deployment target"; for the fuller day-to-day
contributor walkthrough (including where things live in the codebase once it's running) see
[development/setup.md](../development/setup.md), which this page is deliberately consistent with —
both originate from the same source material, `docs/Setup.md`, one of the 47 phase-era docs written
as the project was built.

Nothing here is aspirational. Every command below is a real script in a real `package.json`
(`package.json`, `apps/web/package.json`, `packages/database/package.json`), and every fallback
described is a real code branch, not a documented-but-unimplemented intention.

## Prerequisites

| Requirement | Why |
| --- | --- |
| **Node.js 20+** | `package.json`'s `engines.node` requires `>=20.0.0`. |
| **pnpm, via corepack** | `packageManager: "pnpm@9.15.0"` is pinned in the root `package.json`. `corepack pnpm <cmd>` resolves that exact version without a separate global pnpm install. |
| **PostgreSQL** | Local via the bundled `docker-compose.yml`, or any hosted instance (Supabase, Neon, RDS, self-hosted — anything reachable by a `postgresql://` connection string works). Must support the `pgvector` extension — see [Docker](./docker.md#pgvector--a-real-gotcha) and [Troubleshooting](./troubleshooting.md#pgvector-extension-missing). |
| **Docker** | Optional. Only needed for the bundled Postgres/Redis containers, or to build/run the production image locally. |

Everything else — Redis, Supabase Storage, SMTP, every AI/embedding provider — is optional in
development, each with a real, code-verified fallback (see [Optional integrations](#optional-integrations)).

## The flow

```mermaid
flowchart TD
    A["corepack pnpm install"] --> B["cp .env.example .env"]
    B --> C["fill in DATABASE_URL, BETTER_AUTH_SECRET"]
    C --> D["docker compose up -d postgres"]
    D --> E["corepack pnpm db:migrate"]
    E --> F{"want demo data?"}
    F -- yes --> G["corepack pnpm db:seed"]
    F -- no --> H["corepack pnpm dev"]
    G --> H
    H --> I["visit localhost:3000, sign up"]
```

### 1. Install dependencies

```bash
corepack pnpm install
```

One install at the repo root covers every workspace (`pnpm-workspace.yaml` lists `apps/*` and
`packages/*`, orchestrated by Turborepo per `turbo.json`). Internal packages (`@bond-os/shared`,
`@bond-os/ui`, etc.) are consumed as TypeScript source by `apps/web` directly — there is no separate
per-package build step before `pnpm dev` can start. Never run `npm install`/`yarn` inside an
individual package; this is a pnpm workspace and mixing package managers will produce a second,
inconsistent lockfile.

### 2. Configure environment variables

```bash
cp .env.example .env
```

`.env.example` is the real, checked-in template — every variable in it (and its comments) is exactly
what `packages/shared/src/env.ts` validates at boot. Fill in at minimum:

- **`DATABASE_URL`** — see [Database](#3-database) below.
- **`BETTER_AUTH_SECRET`** — any random string 16+ characters (`openssl rand -base64 32`). `env.ts`
  accepts `NEXTAUTH_SECRET` as a legacy fallback name if that's set instead.
- **`APP_URL`** / **`NEXT_PUBLIC_APP_URL`** — `http://localhost:3000` for local dev. This is also the
  exact value `assertSameOrigin()` (`apps/web/lib/csrf.ts`) checks every mutating request's `Origin`
  header against, and what Better Auth's `trustedOrigins` is set to (`packages/auth/src/server.ts`) —
  get this wrong even locally and every `POST`/`PATCH`/`DELETE` request fails with
  `403 Cross-origin request rejected`.

Full variable-by-variable detail (every section of `.env.example`, required-vs-optional, defaults) is
in [Environment Variables](./environment.md). **Do not set `NODE_ENV`** in `.env` — see
[Troubleshooting](./troubleshooting.md#node_env-set-in-env-breaks-the-production-build).

### 3. Database

**Option A — local Postgres via Docker (fastest):**

```bash
docker compose up -d postgres
```

Starts exactly the `postgres` service in `docker-compose.yml` (`postgres:16-alpine`, database/user/
password all `bondos`, port `5432`, with a `pg_isready` healthcheck, data persisted in the
`bondos-postgres-data` named volume). This matches the `DATABASE_URL` already in `.env.example`
(`postgresql://bondos:bondos@localhost:5432/bondos?schema=public`) — no changes needed if you use
this path. Note this command does **not** start the `web` service — see [Docker](./docker.md) for why
(the `full` profile).

**Option B — a hosted Postgres instance** (Supabase, Neon, RDS, your own server): set `DATABASE_URL`
to its connection string instead. It must have (or be able to create) the `vector` extension — see the
pgvector note in [Docker](./docker.md#pgvector--a-real-gotcha).

Then apply migrations and generate the Prisma Client:

```bash
corepack pnpm db:migrate
```

This runs `prisma migrate dev` inside `packages/database` (`db:migrate` → `pnpm --filter
@bond-os/database run migrate:dev`, itself `dotenv -e ../../.env -- prisma migrate dev`), which also
runs `prisma generate` automatically. As of this writing there is exactly **one** migration on disk,
`packages/database/prisma/migrations/20260718000000_init/`, covering the full schema (67 models / 46
enums). Per `docs/Setup.md`'s own note, this repository was built in a sandboxed environment with no
live Postgres available — the migration was generated offline (`prisma migrate diff --from-empty`)
and schema-validated (`prisma validate`), but never actually applied to a real database until now.
Running `pnpm db:migrate` for the first time against your own Postgres is genuinely the first real
application of that migration, not a formality.

Optionally seed demo data (an organization + workspace, so the dashboard isn't empty):

```bash
corepack pnpm db:seed
```

The seed script (`packages/database/prisma/seed.ts`) deliberately does **not** create a working
login — Better Auth owns password hashing end-to-end, and replicating its hash format in a seed script
would be fragile. Sign up for a real account via `/signup` instead; the first organization you create
there runs through the same `createOrganizationWithWorkspace` path production traffic uses.

### 4. Run it

```bash
corepack pnpm dev
```

This is `turbo run dev`. `turbo.json`'s `dev` task is `cache: false, persistent: true, dependsOn:
["^generate"]` — Turborepo makes sure the Prisma Client is generated in `packages/database` before
starting `apps/web`'s own `dev` script (`dotenv -e ../../.env -- next dev`). Visit
`http://localhost:3000`, sign up, and the first organization you create becomes your active
workspace.

## Optional integrations and their local fallbacks

None of these are required to run the app locally. Each has a real, code-verified fallback — not just
a documented one:

| Integration | Env vars | Without it |
| --- | --- | --- |
| **Redis** | `REDIS_URL` | `getCache()` (`packages/shared/src/cache.ts`) returns an `InMemoryCache` instead of a `RedisCache` — fine for local dev and single-instance deploys. With Docker: `docker compose up -d redis`, then set `REDIS_URL="redis://localhost:6379"`. |
| **Supabase Storage** | `SUPABASE_URL`, `SUPABASE_KEY` | Avatar/organization-logo uploads (and comment attachments) return a clear "Supabase Storage is not configured" error instead of silently failing; everything else works normally. |
| **SMTP** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Password-reset emails are logged to the console instead of sent (`packages/auth/src/email.ts`) — copy the reset link out of the terminal. |
| **Embeddings** | `EMBEDDING_PROVIDER` (default `LOCAL`) | The zero-config deterministic local embedding provider is used — no API key needed to boot retrieval/RAG at all. See [ai/embeddings.md](../ai/embeddings.md). |
| **AI generation** | `AI_PROVIDER`, `ANTHROPIC_API_KEY`, etc. | Left unset by default. `@bond-os/ai`'s own `package.json` states plainly it is "infrastructure only — nothing in this codebase calls `generate()`/`stream()` yet" — nothing in local dev needs this set. See [ai/providers.md](../ai/providers.md). |
| **Cron / scheduled workflows** | `CRON_SECRET` | Unset by default; `POST /api/workflows/schedule/tick` returns `404` for every caller. No `SCHEDULED`-trigger workflow or `WAIT`/`DELAY` step resumes on its own in local dev unless you set this and call the tick endpoint yourself. See [Workflow Scheduler](../workflows/scheduler.md). |

## Useful commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server (all packages, via Turborepo) |
| `pnpm build` | Production build of every package/app |
| `pnpm lint` | Lint every package/app (`eslint . --max-warnings 0`, zero-warning policy) |
| `pnpm typecheck` | Type-check every package/app (`tsc --noEmit`) |
| `pnpm format` / `pnpm format:check` | Format / check formatting with Prettier across the repo |
| `pnpm clean` | `turbo run clean && rm -rf node_modules` |
| `pnpm db:generate` | Regenerate the Prisma Client only |
| `pnpm db:migrate` | Apply Prisma migrations (dev, interactive — may create new migrations) |
| `pnpm db:migrate:deploy` | Apply existing migrations non-interactively (production/CI) |
| `pnpm db:seed` | Seed demo data (an organization + workspace, no login) |
| `pnpm db:studio` | Open Prisma Studio (browse/edit data) |
| `pnpm --filter @bond-os/database run validate` | `prisma validate` — schema-only check, no DB connection required |

## Running the containerized ("production-style") stack locally

```bash
docker compose --profile full up -d --build
```

This builds `Dockerfile` and runs the `web` container alongside `postgres`/`redis`, wired together on
the Compose network (port `3000` for the app). It is the closest thing to a production topology you
can run on a laptop, and is a genuinely useful smoke test before a real deploy — but note it is a
**separate** flow from `pnpm dev`: the containerized `web` service runs the compiled `next start`
equivalent (`node apps/web/server.js` against the standalone build), not the dev server, and does not
hot-reload. Set real secrets in `.env` first — `docker-compose.yml`'s `web` service loads it via
`env_file`. Full explanation of the Dockerfile stages and the `full` profile is in [Docker](./docker.md).

## Where this flow was actually verified from

`docs/Setup.md`, the phase-era source this page reorganizes, states directly that this repository was
built in a sandboxed environment with **no Postgres available** — migrations were generated and
schema-validated (`prisma validate`) but never run against a live database during development itself.
That means `docker compose up -d postgres` + `pnpm db:migrate` really is a first-time operation for
this codebase, not a well-worn path — if you hit something unexpected on that first migration run,
you are plausibly the first person to run it against a real database. See
[Troubleshooting](./troubleshooting.md#no-live-postgres-in-some-dev-sandboxes) for what that
sandboxing limitation looks like in practice and how to tell it apart from a real configuration bug.

## Related documents

- [development/setup.md](../development/setup.md) — the fuller day-to-day contributor walkthrough, including where things live once the app is running.
- [Environment Variables](./environment.md) — every variable, in depth.
- [Docker](./docker.md) — the Dockerfile and docker-compose.yml explained.
- [Troubleshooting](./troubleshooting.md) — Windows symlinks, missing pgvector, OneDrive-synced folders, and other real gotchas.
- [Production](./production.md) — what changes for a real deployment.
