# Production Deployment

## Scope

What actually exists in this repository to run BOND OS in production, stated precisely: one built
artifact (the multi-stage `Dockerfile`), the environment configuration it needs to behave correctly,
and the operational steps the image itself does **not** perform for you (migrations, scheduling,
scaling, health checks). This document does not invent a deployment story beyond what the repo
contains — where something (a Kubernetes manifest, a Terraform module, a Vercel project, a CI/CD
pipeline) doesn't exist, that's stated plainly rather than assumed.

## What "production" means in this repository today

Two concretely-built, tested-by-construction production paths exist: the Docker image defined by the
root `Dockerfile` (self-hosted, see [Docker](./docker.md) for the full stage-by-stage breakdown), and
a live Vercel deployment (see [Deploying to Vercel](#deploying-to-vercel) below). Building the Docker
image:

```bash
docker build -t bond-os .
```

or, for the full local stack (Postgres + Redis + this image, wired together):

```bash
docker compose --profile full up -d --build
```

No other deployment target — no Kubernetes manifests, no Terraform/Pulumi infrastructure code, no
cloud-provider-specific config (AWS/GCP/Azure) — exists anywhere in this repository. The Vercel path
was previously an architectural intent only (the README's own notes state Realtime (P9) uses
reconnecting SSE rather than a WebSocket server "chosen specifically to keep the app deployable both
as a Docker container and on Vercel without committing to one always-on process") — it is now a
verified, working deployment target, not just a design constraint honored in the abstract.

## Deploying to Vercel

### Project configuration

BOND OS is a pnpm + Turborepo monorepo with the Next.js app at `apps/web` and the Prisma schema in a
sibling package (`packages/database`) — deploying it correctly to Vercel requires the monorepo to be
configured, not just imported with defaults. The exact, verified-working configuration:

| Setting | Value | Why |
| --- | --- | --- |
| Root Directory | `apps/web` | Where the Next.js app and its own `package.json` (with `next` as a dependency) live. **Setting this correctly is the single most important step** — see [Common deployment issues](#common-deployment-issues) below for what happens when it's wrong. |
| Framework Preset | Next.js | Auto-detected once Root Directory is correct (Vercel scans the Root Directory's own `package.json` for `next`). |
| Build Command | `turbo run build` (auto-detected) | Vercel's own Turborepo integration sets this automatically once it detects `turbo.json` at an ancestor of Root Directory — no manual override or `vercel.json` needed. This correctly runs `packages/database`'s `generate` task (via `turbo.json`'s `dependsOn: ["^generate"]`) before `apps/web`'s build, exactly mirroring what `pnpm build` does locally. |
| Install Command | `corepack pnpm install` (auto-detected) | Vercel reads `packageManager: "pnpm@9.15.0"` from the repository root `package.json` and the `pnpm-lock.yaml`, and correctly installs from the true monorepo root even though Root Directory points at a subdirectory. |
| Output Directory | Framework default (`.next`) | No override needed. |
| `sourceFilesOutsideRootDirectory` | `true` | A Vercel project setting (not `vercel.json`) that must be enabled for the build to see sibling `packages/*` — without it, only `apps/web`'s own files are uploaded and the build fails immediately with `No package.json found in /` when the build command tries to reach the monorepo root. Vercel sets this automatically when it detects the workspace structure during project creation. |

No `vercel.json` is present in this repository, and none is required — every setting above is either
Vercel's own zero-config Turborepo/pnpm detection (per
[Vercel's official Turborepo monorepo guide](https://vercel.com/docs/monorepos/turborepo)) or a
one-time project setting (Root Directory) configured when the project is created, not a file in the
repo. Adding a `vercel.json` was evaluated and deliberately not done, to avoid unnecessary
configuration duplicating what Vercel already detects correctly.

### Deployment steps

1. **Import the repository.** From the Vercel dashboard: New Project → Import the
   `BOND-OS-BUILD/BONDDOS` GitHub repository (or via CLI: `vercel link` from the repository root,
   which prompts for team/project). Set **Root Directory to `apps/web`** during import — this is the
   one setting that cannot be skipped.
2. **Set environment variables.** See [Vercel Environment Variables](./vercel-env.md) for the complete
   list with descriptions and which are required vs. optional. At minimum: `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL`.
3. **Deploy.** `vercel deploy` for a preview, `vercel deploy --prod` (or merging to the production
   branch, once Git integration triggers deploys) for production.
4. **Run migrations against the production database**, exactly as for any other deployment target —
   Vercel's build does not run `prisma migrate deploy` for you (see
   [Database migrations are not automatic](#database-migrations-are-not-automatic) below; this applies
   identically to Vercel).
5. **Verify** — see [Smoke testing after a Vercel deploy](#smoke-testing-after-a-vercel-deploy) below.

### The three Prisma/Next.js fixes this deployment target required

Getting Prisma working correctly in a Vercel serverless environment, from a monorepo, with a
non-default Prisma Client output path, required three small, deployment-specific additions — none of
them change application behavior, schema data shape, or architecture:

1. **`binaryTargets = ["native", "rhel-openssl-3.0.x"]`** added to `schema.prisma`'s `generator client`
   block. `native` alone resolves correctly for local dev and the Vercel build container, but pinning
   `rhel-openssl-3.0.x` explicitly is defense-in-depth against the build and runtime containers ever
   resolving to different engine targets — a well-documented class of Prisma-on-Vercel failure
   (`PrismaClientInitializationError: Query engine library ... could not be found`).
2. **`outputFileTracingIncludes`** added to `next.config.ts`, pointing at
   `../../packages/database/src/generated/**/*`. `@bond-os/database` generates its Prisma Client to a
   custom path outside `apps/web` (`packages/database/src/generated`, not the default
   `node_modules/.prisma/client`), and the query-engine binary is loaded dynamically at runtime — not a
   statically-analyzable `require()` — so Next's default file-tracing misses it. Without this, the
   build succeeds but every deployed function that queries the database throws at the first request,
   not at build time — confirmed directly by inspecting the build's `.nft.json` trace manifests, which
   now correctly list `generated/libquery_engine-rhel-openssl-3.0.x.so.node`.
3. **`"postinstall": "prisma generate"`** added to `packages/database/package.json`. Redundant with
   `turbo.json`'s `dependsOn: ["^generate"]` when the Build Command goes through `turbo run build` (the
   verified, actual path), but added as defense-in-depth against Vercel's own documented dependency-cache
   behavior (a cached `node_modules` restore can sometimes skip re-running install-time lifecycle
   scripts) and as the officially Prisma-recommended baseline pattern for any Vercel deployment.

### Rollback process

Vercel keeps every previous deployment addressable by its own unique URL and deployment ID — rolling
back does not require a new build or a git revert:

```bash
vercel rollback [deployment-url-or-id]      # revert production to a specific prior deployment
# or, without an argument, roll back to the most recent prior production deployment:
vercel rollback
```

Equivalently, from the dashboard: **Deployments** → find the last known-good deployment → **Promote to
Production**. Both approaches re-point the production alias at an already-built deployment's output —
no rebuild happens, so rollback is fast and doesn't re-run migrations. **A rollback does not revert a
database migration** — if the deployment being rolled back away from included a schema migration, the
database schema stays as that migration left it; reverting a migration is a separate, manual
`prisma migrate` operation the rollback command has no knowledge of. Roll back the application first if
a bad deploy needs to stop serving traffic immediately, then handle any needed schema reversal
separately.

### Smoke testing after a Vercel deploy

If [Deployment Protection](https://vercel.com/docs/deployment-protection) is enabled (Vercel's default
for team projects — every `*.vercel.app` URL redirects to a Vercel-authenticated SSO wall unless a
custom domain is attached), automated smoke tests need
[Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation):
enable it once per project (Project Settings → Deployment Protection, or
`PATCH /v1/projects/{id}/protection-bypass` with `{"generate": {}}`), then pass the generated secret as
an `x-vercel-protection-bypass` header on test requests. This does not disable protection for regular
visitors — only requests carrying the header bypass it.

### Common deployment issues

Two real, encountered-and-fixed issues from setting this deployment up, beyond the Prisma fixes above:

- **`No package.json found in /`** (install command fails) — Root Directory was not set, or a
  `vercel.json`-level `buildCommand`/`installCommand` override used `cd ../..` while the CLI had only
  been linked to the `apps/web` subdirectory directly (uploading just that folder, not the full repo).
  Fix: link/import at the repository root, and set Root Directory as a **project setting** (`apps/web`)
  rather than trying to work around it with relative-path build command tricks.
- **`No Next.js version detected. ... check your Root Directory setting`** — the build reached
  Vercel's Next.js-specific post-processing step while Root Directory was still pointing at (or
  defaulting to) the monorepo root, whose `package.json` has no `next` dependency (only
  `apps/web/package.json` does). Fix: same as above — Root Directory must be the actual app directory.
- See [Troubleshooting: pgvector extension missing](./troubleshooting.md#pgvector-extension-missing)
  for the separate (Docker-specific, not Vercel-specific) pgvector gotcha — Vercel deployments
  typically point `DATABASE_URL` at a managed Postgres provider (Supabase, Neon, RDS) rather than the
  bundled `docker-compose.yml` service, so this specific gotcha doesn't apply the same way, but the
  underlying requirement (the `vector` extension must be available) still does.

## Building for production without Docker

Because `next.config.ts` sets `output: 'standalone'`, `pnpm build` produces a self-contained,
dependency-traced server tree that can be run directly with `node`, without Docker, following the same
three-step assembly the `Dockerfile`'s `runner` stage performs:

```bash
corepack pnpm install
corepack pnpm run db:generate
corepack pnpm --filter web run build

# Next's standalone output does not include static assets or public/ —
# copy them in manually, exactly as the Dockerfile's runner stage does:
cp -r apps/web/public apps/web/.next/standalone/apps/web/public
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 \
  node apps/web/.next/standalone/apps/web/server.js
```

This is the same artifact the Docker image ships — running it this way is legitimate for a bare-metal
or VM-based deployment (or any Node-hosting PaaS), it just skips containerization. On native Windows,
the `next build` step in this sequence is exactly where the symlink limitation applies — see
[Troubleshooting](./troubleshooting.md#windows-next-build-eperm-symlink-error).

## Required environment configuration for a real deploy

Full variable-by-variable reference: [Environment Variables](./environment.md). The subset that
actually changes behavior between "works" and "silently broken" in production:

| Variable | Why it matters in production specifically |
| --- | --- |
| `DATABASE_URL` | Must point at a real, reachable Postgres instance with the `vector` extension available (see [pgvector](./docker.md#pgvector--a-real-gotcha)). |
| `BETTER_AUTH_SECRET` | Must be a real random secret, not the placeholder in `.env.example` — sessions are signed with it. Rotating it invalidates every existing session. |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | **Must exactly match the real, publicly-reachable origin** (scheme + host + port) the app is served from. See [the CSRF trap](#app_url-correctness-the-csrfbetter-auth-trap) below — this is the single easiest thing to get wrong in a first production deploy. |
| `CRON_SECRET` | Unset by default (no default value exists, deliberately). Must be set, and an external scheduler wired to `POST /api/workflows/schedule/tick`, for any `SCHEDULED`-trigger workflow or `WAIT`/`DELAY` step to ever fire. See [Scheduling](#scheduling-nothing-fires-until-this-is-wired) below. |
| `SUPABASE_URL` / `SUPABASE_KEY` | Without these, avatar/logo uploads and comment attachments fail with a clear error for every real user — acceptable for a demo, not for real production usage. |
| `SMTP_*` | Without these, password-reset emails are only ever logged to the container's stdout, which real users cannot see — the forgot-password flow is non-functional for real users without SMTP configured. |

## `APP_URL` correctness: the CSRF/Better-Auth trap

Two independent places in the codebase check incoming requests against `APP_URL`, and both fail
closed:

```ts
// apps/web/lib/csrf.ts
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) throw new ForbiddenError('Missing Origin header.');
  const allowed = new URL(getEnv().APP_URL).origin;
  if (origin !== allowed) throw new ForbiddenError('Cross-origin request rejected.');
}
```

```ts
// packages/auth/src/server.ts
baseURL: env.APP_URL,
trustedOrigins: [env.APP_URL],
```

Every mutating API route (`POST`/`PATCH`/`DELETE`) calls `assertSameOrigin(request)`, and Better
Auth's own session/cookie handling trusts only `env.APP_URL`. If `APP_URL` is set to
`http://localhost:3000` (the `.env.example` default) while the app is actually served from
`https://app.example.com`, every mutating request from real users fails with `403 Cross-origin request
rejected`, and Better Auth's own endpoints reject the mismatched origin too — the app will look like
it's running (pages load, reads work) while every write silently fails. Set `APP_URL` and
`NEXT_PUBLIC_APP_URL` to the exact production origin — including the correct scheme (`https://`, not
`http://`) and no trailing slash — before anything else in a production deploy.

## Database migrations are not automatic

Neither the `Dockerfile`'s `CMD` (`node apps/web/server.js`) nor `docker-compose.yml` runs any Prisma
migration command. An operator must run migrations against the target database explicitly, as a
separate step, before (or alongside) starting the application:

```bash
corepack pnpm db:migrate:deploy
```

This is `prisma migrate deploy` (via `packages/database`'s `migrate:deploy` script) — applies existing
migrations non-interactively and never attempts to create a new one, which is the correct command for
a non-interactive production/CI context (`prisma migrate dev`, used locally, will attempt schema-diff
prompts that have no interactive terminal to answer them in production). As of this writing there is
exactly one migration on disk (`packages/database/prisma/migrations/20260718000000_init/`) covering
the entire schema — see [Local Development](./local.md#3-database) for why even that one migration has
never actually been applied to a live database by this project's own build process.

## Scheduling: nothing fires until this is wired

There is no background worker process anywhere in this codebase — confirmed repeatedly across the
architecture (`Queue` in `packages/shared/src/queue.ts` is always in-memory with nothing consuming it;
`ApprovalRequest` expiry, `SyncJob`/`EmbeddingJob` retries, and workflow scheduling are all either
checked opportunistically on access or driven by one HTTP endpoint). For time-based workflow execution
specifically — cron-style `SCHEDULED` triggers and `WAIT`/`DELAY` step resumption — that one endpoint
is `POST /api/workflows/schedule/tick`, authenticated by a `CRON_SECRET` bearer token, and it does
**nothing** unless something outside the application calls it periodically. A production deployment
that skips this step has a fully functional event-driven and manually-triggered workflow platform and
**zero** time-based execution — no error, just workflows that never fire on their configured schedule.
See [Scheduler](../workflows/scheduler.md) for the complete mechanism, including the three external
caller options its own code comments name (Vercel Cron, a GitHub Actions scheduled workflow, or an
OS-level Task Scheduler/cron entry).

## Scaling considerations

Three infrastructure primitives in `packages/shared` ship with in-memory-by-default implementations
that transparently swap for a shared backend when configured — except one does not actually have a
shared-backend implementation at all, which matters once you run more than one `web` instance:

| Primitive | File | Behavior with `REDIS_URL` unset | Behavior with `REDIS_URL` set |
| --- | --- | --- | --- |
| `Cache` (`getCache()`) | `packages/shared/src/cache.ts` | `InMemoryCache` — per-instance, not shared | `RedisCache` — shared across instances |
| `RateLimiter` (`getRateLimiter()`) | `packages/shared/src/rate-limit.ts` | `InMemoryRateLimiter` — per-instance | **Still `InMemoryRateLimiter`.** There is no Redis-backed `RateLimiter` implementation anywhere in this codebase, despite the file's own doc comment describing that as the intended future ("swap in a Redis-backed implementation ... once running multiple instances"). `REDIS_URL` being set has no effect on rate limiting at all. |
| `Queue` (`getQueue()`) | `packages/shared/src/queue.ts` | `InMemoryQueue` — records enqueue calls, nothing processes them | Same — no Redis/BullMQ-backed `Queue` implementation exists either; this is documented as intentionally infrastructure-only ("prepare the interface, no workers"). |

Practical consequence: running multiple `web` instances behind a load balancer works for request
handling and (with `REDIS_URL` set) for cached data, but every route wrapped in `withRateLimit(...)`
(the tick endpoint, the approval endpoint, others) enforces its limit **per instance**, not globally —
an attacker or a misbehaving client spread across instances can exceed the nominal limit by a factor
of however many instances are running. This is a real, verified architectural gap, not a
misconfiguration; see [Architecture: Scalability](../architecture/scalability.md) for the fuller
picture of what does and doesn't horizontally scale in this codebase today.

## What's not handled for you

Stated plainly, matching this codebase's own documentation style of naming gaps rather than hiding
them:

- **No health-check endpoint suitable for an external prober or orchestrator.** See
  [Monitoring](./monitoring.md#no-health-check-endpoint).
- **No log shipping or aggregation.** Structured JSON logs go to stdout via pino; nothing forwards
  them anywhere. See [Monitoring](./monitoring.md).
- **No automated backups.** See [Backups](./backups.md).
- **No secrets manager integration.** Secrets are plain environment variables, sourced from a local
  `.env` file (via `env_file:` in Compose) or however the hosting platform injects environment
  variables — there is no Vault/AWS Secrets Manager/GCP Secret Manager client anywhere in this
  codebase. Several sensitive columns (`WorkflowDefinition.webhookSecret`, `Account.accessToken`/
  `refreshToken`, `Account.password`) are also plaintext at rest in Postgres — see
  [Security: Secrets](../security/secrets.md).
- **No TLS termination.** The app listens on plain HTTP (`PORT=3000`, `HOSTNAME=0.0.0.0`); TLS is
  expected to be handled by whatever sits in front of it (a reverse proxy, a load balancer, a
  platform's own edge) — nothing in this repository configures certificates.
- **No autoscaling configuration** — no Kubernetes HPA, no cloud-provider autoscaling group, because
  there is no orchestrator manifest of any kind in this repository to begin with.
- **No CI/CD pipeline gating a deploy.** See [GitHub](./github.md) — there is no `.github/workflows`
  directory; every verification step (`prisma validate`, `typecheck`, `lint`, `build`) is run manually
  before a commit, not automatically before a deploy.

## Pre-deploy checklist

Derived directly from `CONTRIBUTING.md`'s own review checklist — the same manual verification this
project's real commit history records per change, applied once more before shipping a build:

- [ ] `pnpm --filter @bond-os/database run validate` (`prisma validate`) — schema-only, no DB
      connection required.
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm build` (or `docker build` / `docker compose --profile full up -d --build`)
- [ ] `APP_URL`/`NEXT_PUBLIC_APP_URL` set to the real production origin (see above).
- [ ] `BETTER_AUTH_SECRET` set to a real, unique secret.
- [ ] `DATABASE_URL` reachable, with the `vector` extension available.
- [ ] `pnpm db:migrate:deploy` run against the production database.
- [ ] `CRON_SECRET` set and an external scheduler wired, if any scheduled workflow or `WAIT`/`DELAY`
      step is expected to fire (see [Scheduling](#scheduling-nothing-fires-until-this-is-wired)).
- [ ] `SUPABASE_URL`/`SUPABASE_KEY` and `SMTP_*` set if uploads and password-reset email need to work
      for real users.
- [ ] A dev-server or containerized smoke test against the built artifact, not just the dev server —
      the standalone build and `next dev` are genuinely different code paths (see
      [Docker](./docker.md)).
- [ ] **Vercel only:** Root Directory project setting is `apps/web` (not left at the repository root).
- [ ] **Vercel only:** `binaryTargets`/`outputFileTracingIncludes`/`postinstall` fixes are present (see
      [The three Prisma/Next.js fixes this deployment target required](#the-three-prismanextjs-fixes-this-deployment-target-required))
      — these are already committed to the repository, not a per-deploy manual step, but worth
      confirming if diagnosing a fresh clone or fork.
- [ ] **Vercel only:** a Protection Bypass for Automation secret exists if any automated smoke test or
      monitoring needs to reach a Deployment-Protection-gated URL.

## Related documents

- [Docker](./docker.md) — the image this section builds and runs, explained stage by stage.
- [Vercel Environment Variables](./vercel-env.md) — the Vercel-specific env var reference (required/
  optional, example values, which services depend on each).
- [Environment Variables](./environment.md) — full reference for any deployment target.
- [Scheduler](../workflows/scheduler.md) — the tick endpoint in full detail, including the Vercel Cron
  wiring caveat (a `GET`-vs-`POST` mismatch — see [vercel-env.md](./vercel-env.md#wiring-the-scheduler-vercel-cron)).
- [Backups](./backups.md) — what's manual today.
- [Monitoring](./monitoring.md) — what observability exists, and what doesn't.
- [Security: Secrets](../security/secrets.md) — plaintext-at-rest columns and what that means operationally.
- [Architecture: Scalability](../architecture/scalability.md) — the broader scaling picture this document's [Scaling considerations](#scaling-considerations) section is drawn from.
- [Troubleshooting](./troubleshooting.md) — the Windows symlink limitation (Vercel's Linux build
  environment is unaffected) and other environment-specific gotchas.
