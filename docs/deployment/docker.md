# Docker

## Scope

The two real files that define BOND OS's container story: `Dockerfile` (the production image) and
`docker-compose.yml` (local Postgres/Redis, plus an optional full containerized stack). Both are
reproduced and explained stage-by-stage/service-by-service below, against the files as they actually
exist in the repository root — nothing here is a hypothetical Kubernetes manifest or Helm chart; none
exist in this repository.

## The Dockerfile

```dockerfile
# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

# ── deps: install workspace dependencies ────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

# ── builder: generate prisma client + build the app ─────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps ./apps
COPY . .
RUN corepack pnpm run db:generate
RUN corepack pnpm --filter web run build

# ── runner: minimal production image ─────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
```

```mermaid
flowchart LR
    subgraph base["base (node:20-alpine, corepack enable)"]
    end
    subgraph deps["deps"]
        D1["copy every package.json in the workspace"]
        D2["pnpm install --frozen-lockfile"]
    end
    subgraph builder["builder"]
        B1["copy deps' node_modules + full source"]
        B2["pnpm run db:generate (prisma generate)"]
        B3["pnpm --filter web run build (next build, standalone)"]
    end
    subgraph runner["runner (minimal, non-root)"]
        R1["copy apps/web/public"]
        R2["copy .next/standalone → /"]
        R3["copy .next/static → apps/web/.next/static"]
        R4["USER nextjs, EXPOSE 3000"]
        R5["CMD node apps/web/server.js"]
    end
    base --> deps --> builder --> runner
```

### Stage 1 — `base`

`node:20-alpine`, matching the `engines.node: ">=20.0.0"` requirement in the root `package.json`.
`corepack enable` makes the `packageManager: "pnpm@9.15.0"` pin in `package.json` resolve
automatically — every stage that runs `pnpm`/`corepack pnpm` gets exactly that version, with no
separate global pnpm install step.

### Stage 2 — `deps`

Copies only the workspace manifest files (`pnpm-workspace.yaml`, root `package.json`,
`pnpm-lock.yaml`) plus every individual `package.json` that's actually needed to resolve the
dependency graph — `apps/web`, and `packages/config`, `shared`, `database`, `auth`, `ui`. Note what's
**not** copied here: `packages/ai`, `packages/embeddings`, `packages/connectors`,
`packages/extraction`, `packages/parsers` do not get their own `COPY` line in this stage even though
`apps/web/package.json` depends on all of them as `workspace:*`. This works because `pnpm install
--frozen-lockfile` at the workspace root still resolves the full dependency tree from the lockfile
regardless of which individual `package.json` files were copied — the explicit `COPY` lines here are
about Docker layer caching (only these packages' manifests need to change to invalidate this layer),
not about correctness. Then `pnpm install --frozen-lockfile` installs everything — `--frozen-lockfile`
means it fails outright rather than silently updating `pnpm-lock.yaml` if the lockfile and manifests
have drifted apart, which is exactly the behavior you want in a reproducible image build.

### Stage 3 — `builder`

Copies `deps`' installed `node_modules`, then the full `packages` and `apps` trees, then `COPY . .`
(the rest of the build context, filtered by `.dockerignore`). Runs two commands:

1. **`corepack pnpm run db:generate`** — the root `db:generate` script, `pnpm --filter
   @bond-os/database run generate` → `prisma generate`. Produces the Prisma Client at
   `packages/database/src/generated` (gitignored, so it does not exist until this step runs).
2. **`corepack pnpm --filter web run build`** — `apps/web`'s own `build` script, `dotenv -e ../../.env
   -- next build`. `next.config.ts` sets `output: 'standalone'`, so this produces
   `apps/web/.next/standalone` (a self-contained, dependency-traced copy of only what's needed at
   runtime) alongside the normal `.next` build output. Note: `apps/web/package.json`'s `build` script
   itself invokes `dotenv -e ../../.env`, which means the builder stage's `next build` reads whatever
   `.env` file is present in the build context at that point (see [Environment
   Variables](./environment.md) for which variables actually affect a build vs. only runtime).

### Stage 4 — `runner`

A fresh copy of `base` — none of `deps`'/`builder`'s build tooling, dev dependencies, or full
`node_modules` carry over, only what standalone output actually traced. `NODE_ENV=production` is set
explicitly here (this is the one place in the whole repository that sets it — `.env`/`.env.example`
deliberately never does, see [Environment Variables](./environment.md#node_env)). A non-root user
(`nextjs`, uid/gid `1001`) is created and owns the copied standalone output and static assets — the
process never runs as root inside the container. Three `COPY --from=builder` lines assemble exactly
what Next's standalone output needs to run (`public/`, the standalone server tree, and `.next/static`,
which standalone output does *not* include by default and must be copied in manually — this mirrors
[Next.js's own documented standalone-deployment steps](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
exactly). `EXPOSE 3000` / `PORT=3000` / `HOSTNAME="0.0.0.0"` are the standalone server's own
`server.js`'s listen configuration — binding to `0.0.0.0` (not `localhost`) is required for the port
to be reachable from outside the container. `CMD ["node", "apps/web/server.js"]` starts the standalone
server directly with plain `node` — no `next start`, no package manager involved at runtime at all.

**What the runner stage does *not* do:** it does not run database migrations. There is no
`prisma migrate deploy` anywhere in this Dockerfile or in the image's `CMD`. An operator must run
`pnpm db:migrate:deploy` against the target database separately, before or alongside starting a
container from this image — see [Production](./production.md#database-migrations-are-not-automatic).

## docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: bondos-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: bondos
      POSTGRES_PASSWORD: bondos
      POSTGRES_DB: bondos
    ports:
      - "5432:5432"
    volumes:
      - bondos-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bondos -d bondos"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: bondos-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - bondos-redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  web:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: bondos-web
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://bondos:bondos@postgres:5432/bondos?schema=public
      REDIS_URL: redis://redis:6379
    profiles:
      - full

volumes:
  bondos-postgres-data:
  bondos-redis-data:
```

```mermaid
flowchart TB
    subgraph compose["docker-compose.yml"]
        PG["postgres:16-alpine\nport 5432\nvolume: bondos-postgres-data\nhealthcheck: pg_isready"]
        RD["redis:7-alpine\nport 6379\nvolume: bondos-redis-data\nhealthcheck: redis-cli ping"]
        WEB["web (built from ./Dockerfile)\nport 3000\nprofile: full\nDATABASE_URL → postgres:5432\nREDIS_URL → redis:6379"]
    end
    WEB -- depends_on: service_healthy --> PG
    WEB -- depends_on: service_healthy --> RD
    HOST["host machine: pnpm dev"] -- DATABASE_URL=localhost:5432 --> PG
    HOST -- REDIS_URL=localhost:6379 --> RD
```

### `postgres`

`postgres:16-alpine`, credentials fixed to `bondos`/`bondos`/`bondos` (user/password/db — this is a
local-dev convenience default, not something to reuse in production; see
[Environment Variables](./environment.md#database)). Published on the host's `5432`, backed by a named
volume (`bondos-postgres-data`) so data survives `docker compose down` (though not `docker compose
down -v`). The `pg_isready` healthcheck is what `web`'s `depends_on: condition: service_healthy` waits
on.

### `redis`

`redis:7-alpine`, published on `6379`, backed by `bondos-redis-data`. This is what `REDIS_URL` should
point at once you want `getCache()` (`packages/shared/src/cache.ts`) to use `RedisCache` instead of
the in-memory fallback. Note that Redis being up does **not** change the app's rate limiter —
`getRateLimiter()` (`packages/shared/src/rate-limit.ts`) has no Redis-backed implementation at all,
regardless of whether `REDIS_URL` is set; see [Production](./production.md#scaling-considerations) for
why this matters once you run more than one `web` instance.

### `web`

Builds the `Dockerfile` above with build context `.` (the whole repo, filtered by `.dockerignore`).
`depends_on` with `condition: service_healthy` means Compose actually waits for both healthchecks to
pass before starting `web`, not just for the containers to exist. `env_file: .env` loads every
variable from the local `.env` file, and `environment:` then **overrides** `DATABASE_URL` and
`REDIS_URL` specifically to point at the Compose service DNS names (`postgres`, `redis`) rather than
`localhost` — inside the Compose network, `localhost` would refer to the `web` container itself, not
the sibling `postgres`/`redis` containers, so this override is necessary regardless of what
`DATABASE_URL`/`REDIS_URL` say in `.env`.

### `profiles: [full]` — why `docker compose up -d postgres` doesn't also start `web`

`web` is the only service gated behind the `full` Compose profile. Compose profiles are opt-in: a
service with `profiles: [full]` only starts if you explicitly pass `--profile full` (or list it by
name). This is a deliberate split between two real workflows this repository supports:

| Command | What starts | Who uses it |
| --- | --- | --- |
| `docker compose up -d postgres` | Postgres only | Local dev — app runs on the host via `pnpm dev`, hitting `localhost:5432`. See [Local Development](./local.md). |
| `docker compose up -d` (no args) | Postgres + Redis (both have no profile, so they're the default set) | Same, plus wanting Redis-backed caching locally. |
| `docker compose --profile full up -d --build` | Postgres + Redis + `web` (built from `Dockerfile`) | A full containerized, production-shaped stack — the closest local smoke test to a real deploy. |

## `.dockerignore`

```
node_modules
**/node_modules
.next
**/.next
.turbo
**/.turbo
.git
.env
.env.local
*.log
coverage
docs
```

Keeps the build context small and prevents two real footguns: `.env` (so live secrets from a
developer's machine are never accidentally baked into an image layer — the `runner` stage gets its
config at container-start time via `docker-compose.yml`'s `env_file`/`environment`, not at build
time) and `node_modules`/`.next`/`.turbo` (stale local build artifacts that would otherwise shadow
the image's own clean `pnpm install`/`next build`). `docs` is excluded too — documentation changes
never need to invalidate the app image's build cache or bloat the build context.

## pgvector — a real gotcha

`packages/database/prisma/schema.prisma` declares `extensions = [vector]` and the schema's own
`embeddings` table stores an `Unsupported("vector(1536)")` column; the single init migration
(`packages/database/prisma/migrations/20260718000000_init/migration.sql`) begins with:

```sql
CREATE EXTENSION IF NOT EXISTS "vector";
```

`docker-compose.yml`'s `postgres` service uses the **vanilla** `postgres:16-alpine` image. The
official Postgres Docker images (Alpine or Debian-based, any tag) do not ship the `pgvector`
extension pre-installed — there is no init script, no custom Dockerfile, and no `apk add` step
anywhere in this repository's `docker-compose.yml` or Postgres configuration that installs it. Running
`pnpm db:migrate`/`db:migrate:deploy` against the bundled `postgres` service as configured will fail
on `CREATE EXTENSION IF NOT EXISTS "vector"` unless the extension has been made available to that
Postgres instance some other way. This is a genuine configuration gap in the bundled Compose file, not
a hypothetical edge case — verified directly against the migration SQL and the exact image tag in
`docker-compose.yml`. See [Troubleshooting](./troubleshooting.md#pgvector-extension-missing) for the
fix (swapping to a pgvector-enabled Postgres image, e.g. `pgvector/pgvector:pg16`, or installing the
extension into the existing image).

## No healthcheck for `web`

Unlike `postgres` and `redis`, the `web` service in `docker-compose.yml` has no `healthcheck:` block
at all — Compose considers it "up" as soon as the container process starts, regardless of whether the
Next.js server has finished booting or is actually serving traffic successfully. There is also no
lightweight, unauthenticated HTTP endpoint in this codebase designed for that purpose (see
[Monitoring](./monitoring.md#no-health-check-endpoint) — the closest thing, `GET /api/ai/health`,
requires an authenticated session and an active organization, so it cannot be used as a public
liveness/readiness probe as-is). An operator wiring this into an orchestrator with its own health
checks (Kubernetes, ECS, a load balancer) needs to add that probe themselves.

## Related documents

- [Local Development](./local.md) — the `docker compose up -d postgres` day-to-day flow.
- [Production](./production.md) — what else a real deployment needs beyond building this image.
- [Environment Variables](./environment.md) — every variable referenced above, in depth.
- [Troubleshooting](./troubleshooting.md) — the pgvector gap, the Windows symlink issue, and other real gotchas.
- [Monitoring](./monitoring.md) — why `GET /api/ai/health` isn't a usable container healthcheck target.
