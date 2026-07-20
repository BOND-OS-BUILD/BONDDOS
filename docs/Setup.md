# Setup

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) — no global install needed, `corepack pnpm <cmd>` works out of the box on
  Node 16.9+ (or run `corepack enable` once, if your environment allows writing shims)
- A PostgreSQL database (local via Docker, or a hosted instance — Supabase/Neon/RDS/etc. all work)
- Docker (optional, only needed for the bundled `docker-compose.yml` Postgres/Redis, or for building
  the production image)

## 1. Install dependencies

```bash
corepack pnpm install
```

## 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in at minimum:

- `DATABASE_URL` — see [Database](#3-database) below
- `BETTER_AUTH_SECRET` — any random string 16+ characters (`openssl rand -base64 32`)
- `APP_URL` / `NEXT_PUBLIC_APP_URL` — `http://localhost:3000` for local dev

Everything else (`SUPABASE_URL`/`SUPABASE_KEY`, `REDIS_URL`, `SMTP_*`) is optional in development —
see [Optional integrations](#5-optional-integrations).

## 3. Database

**Option A — local Postgres via Docker (fastest):**

```bash
docker compose up -d postgres
```

This matches the `DATABASE_URL` already in `.env.example`
(`postgresql://bondos:bondos@localhost:5432/bondos`) — no changes needed.

**Option B — a hosted Postgres instance** (Supabase, Neon, RDS, your own server): set `DATABASE_URL`
to its connection string instead.

Then apply migrations and generate the Prisma Client:

```bash
corepack pnpm db:migrate
```

(This runs `prisma migrate dev` inside `packages/database`, which also runs `prisma generate`
automatically. Use `pnpm db:migrate:deploy` instead in CI/production — it applies existing migrations
non-interactively without trying to create new ones.)

Optionally seed demo data (an organization + workspace so the dashboard isn't empty):

```bash
corepack pnpm db:seed
```

The seed script intentionally does **not** create a working login — Better Auth owns password
hashing end-to-end, and replicating its hash format in a seed script would be fragile. Sign up for a
real account via `/signup` instead; the first organization you create there follows the exact same
code path (`createOrganizationWithWorkspace`) production traffic uses.

> This repository was built in a sandboxed environment with no Postgres available, so migrations were
> generated (`packages/database/prisma/migrations/`) and schema-validated (`prisma validate`) but
> never applied to a live database. Running `pnpm db:migrate` here for the first time is expected —
> it's not re-running something that was already verified against a real database.

## 4. Run it

```bash
corepack pnpm dev
```

Visit `http://localhost:3000`. Sign up, then create your first organization — you'll land on the
dashboard shell (sidebar + topbar) with that organization active.

## 5. Optional integrations

None of these are required to run the app locally — each has a safe fallback.

**Redis** (`REDIS_URL`) — without it, caching and rate-limiting use in-memory implementations (fine
for local dev and single-instance deploys). With Docker: `docker compose up -d redis`, then set
`REDIS_URL="redis://localhost:6379"`.

**Supabase Storage** (`SUPABASE_URL`, `SUPABASE_KEY`) — without it, avatar/organization-logo uploads
return a clear "Supabase Storage is not configured" error instead of silently failing; everything
else works normally. To enable: create a Supabase project, create a public bucket named
`bondos-public`, and set both env vars (`SUPABASE_KEY` should be a service-role or appropriately-
scoped key — the upload route runs server-side only, it's never exposed to the browser).

**SMTP** (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`) — without it, password-reset
emails are logged to the console instead of sent (`packages/auth/src/email.ts`), so the forgot/reset
password flow is still fully testable locally — copy the reset link out of the terminal.

## 6. Useful commands

| Command                     | What it does                                                |
| ---------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                   | Start the dev server (all packages, via Turborepo)              |
| `pnpm build`                 | Production build of every package/app                           |
| `pnpm lint` / `pnpm typecheck` | Lint / type-check everything                                  |
| `pnpm format`                 | Format the repo with Prettier                                  |
| `pnpm db:studio`              | Open Prisma Studio (browse/edit data)                            |
| `docker compose up -d`        | Start Postgres + Redis (add `--profile full` to also build/run the app in Docker) |

## 7. Docker (production-style build)

```bash
docker compose --profile full up -d --build
```

Builds `Dockerfile` (multi-stage: install → `prisma generate` + `next build` with standalone output →
minimal runtime image) and runs it alongside Postgres and Redis. Set real secrets in `.env` first —
`docker-compose.yml` loads it via `env_file`.

## Troubleshooting

- **"Invalid environment variables" on boot** — `packages/shared/src/env.ts` validates `process.env`
  eagerly and lists exactly which variable is missing/invalid; check it against `.env.example`.
- **Prisma Client type errors** — run `pnpm db:generate` (or any `db:migrate*` command, which runs it
  automatically) after pulling schema changes; the generated client at
  `packages/database/src/generated` is gitignored and must be regenerated locally.
- **"Supabase Storage is not configured"** — expected until you set `SUPABASE_URL`/`SUPABASE_KEY`; see
  [Optional integrations](#5-optional-integrations).
- **Windows: `pnpm build` fails with `EPERM: operation not permitted, symlink ...`** —
  `next.config.ts` uses `output: 'standalone'` (needed for the Docker image), which symlinks traced
  dependencies into `.next/standalone`. Creating symlinks on Windows requires either Developer Mode
  (Settings → Privacy & security → For developers → Developer Mode) or an elevated (Run as
  Administrator) terminal — a Windows OS restriction, unrelated to this project's code. `pnpm dev`,
  Docker builds, WSL, Linux/macOS, and Vercel are all unaffected.
- **Do not set `NODE_ENV` in `.env`** — Next.js manages it contextually (`development` for `next dev`,
  `production` for `next build`/`next start`). Setting it in a loaded `.env` file overrides that; Next
  will warn "non-standard NODE_ENV value" and — because `packages/shared/src/logger.ts` only enables
  pino's pretty-print transport outside production — a stale `development` value during a production
  build makes it try to spin up that transport's worker thread mid-build, which fails.
