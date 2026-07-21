# Development Setup

Getting BOND OS running on your own machine, end to end: install → configure → database → run. This
page documents the flow that actually works against this repository as it exists today — the same
sequence recorded in [`../Setup.md`](../Setup.md) and summarized in [`../../README.md`](../../README.md).
For every environment variable in depth see [`../deployment/environment.md`](../deployment/environment.md);
for the Docker-only path see [`../deployment/docker.md`](../deployment/docker.md); for what's still broken
when something doesn't match this page see [`../deployment/troubleshooting.md`](../deployment/troubleshooting.md).

## Prerequisites

- **Node.js 20+** (`package.json`'s `engines.node` requires `>=20.0.0`).
- **pnpm**, via `corepack` — no global install needed. `corepack pnpm install` works out of the box on
  Node 16.9+; the repo pins `packageManager: pnpm@9.15.0` in the root `package.json`, so corepack always
  resolves the same version regardless of what's globally installed.
- **PostgreSQL** — local via the bundled `docker-compose.yml`, or any hosted instance (Supabase, Neon,
  RDS, your own server all work; the app only needs a valid `DATABASE_URL`).
- **Docker** — optional. Only needed if you want the bundled Postgres/Redis containers instead of your
  own, or if you're building the production image.

Nothing else is required to boot the app. Redis, Supabase Storage, SMTP, and every AI/embedding provider
are all optional with safe, code-verified fallbacks — see [Optional integrations](#optional-integrations)
below.

## The flow

```mermaid
flowchart TD
    A["git clone / open repo"] --> B["corepack pnpm install"]
    B --> C["cp .env.example .env"]
    C --> D["fill in DATABASE_URL, BETTER_AUTH_SECRET"]
    D --> E["docker compose up -d postgres"]
    E --> F["corepack pnpm db:migrate"]
    F --> G{"want demo data?"}
    G -- yes --> H["corepack pnpm db:seed"]
    G -- no --> I["corepack pnpm dev"]
    H --> I
    I --> J["visit localhost:3000, sign up"]
```

### 1. Install dependencies

```bash
corepack pnpm install
```

Installs every workspace package (`apps/web`, `packages/*`) in one pass — this is a pnpm workspace
(`pnpm-workspace.yaml` lists `apps/*` and `packages/*`) orchestrated by Turborepo (`turbo.json`). Internal
packages like `@bond-os/shared` and `@bond-os/ui` are consumed as TypeScript source, not pre-built
artifacts, so there's no separate per-package build step to run here.

### 2. Copy environment variables

```bash
cp .env.example .env
```

`.env.example` is the real, checked-in template — every variable in it, including the comments, is what
`packages/shared/src/env.ts` actually validates. Fill in at minimum:

- **`DATABASE_URL`** — see [Database](#3-database) below.
- **`BETTER_AUTH_SECRET`** — any random string 16+ characters. Generate one with `openssl rand -base64 32`.
  (`NEXTAUTH_SECRET` is accepted as a legacy fallback name if you set that instead — see
  [coding-standards.md](coding-standards.md) for how `env.ts` resolves it.)
- **`APP_URL`** / **`NEXT_PUBLIC_APP_URL`** — `http://localhost:3000` for local dev; this is also what
  `assertSameOrigin()` (`apps/web/lib/csrf.ts`) checks incoming `Origin` headers against.

Everything else — `SUPABASE_URL`/`SUPABASE_KEY`, `REDIS_URL`, `SMTP_*`, every `AI_PROVIDER`/embedding
variable — is optional in development. **Do not set `NODE_ENV`** in `.env`: Next.js sets it contextually
(`development` for `next dev`, `production` for `next build`/`next start`), and a stale value from a
loaded `.env` file overrides that, which both triggers a Next.js warning and — because
`packages/shared/src/logger.ts` only enables pino's pretty-print transport outside production — can make
a production build try to spin up that transport's worker thread mid-build.

### 3. Database

**Option A — local Postgres via Docker (fastest, and what this session used):**

```bash
docker compose up -d postgres
```

This starts exactly the container defined in `docker-compose.yml` (`postgres:16-alpine`, database/user/
password all `bondos`, port `5432`, with a `pg_isready` healthcheck) — it matches the `DATABASE_URL`
already present in `.env.example`
(`postgresql://bondos:bondos@localhost:5432/bondos?schema=public`), so no changes are needed if you use
this path.

**Option B — a hosted Postgres instance:** set `DATABASE_URL` to its connection string instead. Nothing
else in the app cares which path you took.

Then apply migrations and generate the Prisma Client:

```bash
corepack pnpm db:migrate
```

This runs `prisma migrate dev` inside `packages/database` (`db:migrate` → `pnpm --filter @bond-os/database
run migrate:dev`, which is `dotenv -e ../../.env -- prisma migrate dev`), which also runs `prisma
generate` automatically. As of this writing there is exactly **one** migration on disk —
`packages/database/prisma/migrations/20260718000000_init/` — covering the entire current schema (all 67
models / 46 enums). It was generated offline (`prisma migrate diff --from-empty`) in a sandboxed
environment with no live Postgres available, so running `pnpm db:migrate` for the first time against your
own database is genuinely the first time that migration has ever been applied — not a formality. Use
`pnpm db:migrate:deploy` instead in CI/production: it applies existing migrations non-interactively
without trying to create new ones.

Optionally seed demo data (an organization + workspace, so the dashboard isn't empty):

```bash
corepack pnpm db:seed
```

The seed script (`packages/database/prisma/seed.ts`) deliberately does **not** create a working login —
Better Auth owns password hashing end-to-end, and replicating its hash format in a seed script would be
fragile and could silently drift out of sync. Sign up for a real account via `/signup` instead; the first
organization you create there runs through the exact same code path
(`createOrganizationWithWorkspace` in `packages/database/src/queries/organizations.ts`) production traffic
uses.

### 4. Run it

```bash
corepack pnpm dev
```

This is `turbo run dev`, which runs `apps/web`'s `dev` script (`dotenv -e ../../.env -- next dev`) and, per
`turbo.json`'s `dependsOn: ["^generate"]` on the `dev` task, makes sure the Prisma Client is generated
first. Visit `http://localhost:3000`, sign up, and the first organization you create becomes your active
workspace (stored via a cookie — see [architecture.md](architecture.md#state--session)).

## Optional integrations

None of these are required to run the app locally — each one has a code-verified fallback, not just a
documented one:

| Integration | Env vars | Without it |
| --- | --- | --- |
| **Redis** | `REDIS_URL` | `getCache()` (`packages/shared/src/cache.ts`) returns an `InMemoryCache` instead of a Redis-backed one — fine for local dev and single-instance deploys. With Docker: `docker compose up -d redis`, then set `REDIS_URL="redis://localhost:6379"`. |
| **Supabase Storage** | `SUPABASE_URL`, `SUPABASE_KEY` | Avatar/organization-logo uploads (and, per Phase 9, comment attachments) return a clear "Supabase Storage is not configured" error instead of silently failing. |
| **SMTP** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Password-reset emails are logged to the console instead of sent (`packages/auth/src/email.ts`) — copy the reset link out of the terminal. |
| **Embeddings** | `EMBEDDING_PROVIDER` (default `LOCAL`) | The zero-config deterministic local embedding provider is used — no API key needed to boot the RAG/retrieval pipeline at all. |
| **AI generation** | `AI_PROVIDER` | Left unset by default. `@bond-os/ai`'s own `package.json` states it is "infrastructure only — nothing in this codebase calls `generate()`/`stream()` yet," so this genuinely has no working zero-config default and nothing currently depends on it being set — see [`../ai/providers.md`](../ai/providers.md). |

## Useful commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server (all packages, via Turborepo) |
| `pnpm build` | Production build of every package/app |
| `pnpm lint` | Lint every package/app (`eslint . --max-warnings 0` per package — see [coding-standards.md](coding-standards.md#linting)) |
| `pnpm typecheck` | Type-check every package/app (`tsc --noEmit`) |
| `pnpm format` / `pnpm format:check` | Format / check formatting with Prettier across the repo |
| `pnpm db:generate` | Regenerate the Prisma Client only |
| `pnpm db:migrate` | Apply Prisma migrations (dev, interactive) |
| `pnpm db:migrate:deploy` | Apply Prisma migrations (production/CI, non-interactive) |
| `pnpm db:seed` | Seed demo data (an organization + workspace, no login) |
| `pnpm db:studio` | Open Prisma Studio — see [debugging.md](debugging.md#prisma-studio) |
| `pnpm --filter @bond-os/database run validate` | `prisma validate` — schema-only check, no DB connection required |

## Docker (production-style build)

```bash
docker compose --profile full up -d --build
```

Builds `Dockerfile` (multi-stage: install workspace deps → `prisma generate` + `next build` with
`output: 'standalone'` → a minimal `node:20-alpine` runtime image running as a non-root `nextjs` user) and
runs it alongside the same `postgres`/`redis` containers, on port 3000. The `web` service is gated behind
the `full` Docker Compose profile specifically so `docker compose up -d` (no profile) only starts
Postgres/Redis for local `pnpm dev` use — it does not also build and run the app. Set real secrets in
`.env` first; `docker-compose.yml` loads it via `env_file`. Full detail in
[`../deployment/docker.md`](../deployment/docker.md).

## Windows: the Developer Mode / symlink note

This is real, reproducible, and specific to native Windows (outside Docker/WSL) — it is called out
directly in `next.config.ts`'s own comments, not just in docs:

`next.config.ts` sets `output: 'standalone'` (needed for the Docker image above) — this makes `next
build` trace and **symlink** every runtime dependency into `.next/standalone`. Creating symlinks on
Windows requires either:

- **Developer Mode**: Settings → Privacy & security → For developers → Developer Mode, or
- an **elevated** (Run as Administrator) terminal.

Without one of those, `pnpm build` fails with `EPERM: operation not permitted, symlink ...`. This is a
Windows OS restriction, not a bug in this project's config. It does **not** affect:

- `pnpm dev` (no standalone tracing/symlinking happens for the dev server),
- Docker builds (the symlinking happens inside the Linux container),
- WSL, Linux, or macOS, or
- Vercel deployments.

If you only need to run the app locally for development, you will never hit this — it only matters if
you run `pnpm build` / `next build` directly on native Windows.

## Troubleshooting

- **"Invalid environment variables" on boot** — `packages/shared/src/env.ts` validates `process.env`
  eagerly (zod) and fails fast with a formatted, multi-line error listing exactly which variable is
  missing or invalid. Check it against `.env.example`.
- **Prisma Client type errors** — run `pnpm db:generate` (or any `db:migrate*` command, which runs it
  automatically) after pulling schema changes. The generated client at `packages/database/src/generated`
  is gitignored and must be regenerated locally; it is not checked into the repo.
- **"Supabase Storage is not configured"** — expected until you set `SUPABASE_URL`/`SUPABASE_KEY`; see
  [Optional integrations](#optional-integrations).
- **`EPERM: operation not permitted, symlink ...` on Windows** — see
  [the Developer Mode note](#windows-the-developer-mode--symlink-note) above.
- **Non-standard `NODE_ENV` warning, or a build that tries to spawn a pino-pretty worker thread and
  fails** — you have `NODE_ENV` set in `.env`; remove it (see [step 2](#2-copy-environment-variables)).

For deeper environment-variable-by-environment-variable detail see
[`../deployment/environment.md`](../deployment/environment.md); for how this all changes in a real
deployment target see [`../deployment/production.md`](../deployment/production.md). Once the app is
running, [architecture.md](architecture.md) is the next stop for where to actually put new code, and
[adding-features.md](adding-features.md) walks a full feature addition end to end.
