# Production Deployment

## Scope

What actually exists in this repository to run BOND OS in production, stated precisely: one built
artifact (the multi-stage `Dockerfile`), the environment configuration it needs to behave correctly,
and the operational steps the image itself does **not** perform for you (migrations, scheduling,
scaling, health checks). This document does not invent a deployment story beyond what the repo
contains — where something (a Kubernetes manifest, a Terraform module, a Vercel project, a CI/CD
pipeline) doesn't exist, that's stated plainly rather than assumed.

## What "production" means in this repository today

There is exactly one concretely-built, tested-by-construction production artifact: the Docker image
defined by the root `Dockerfile` (see [Docker](./docker.md) for the full stage-by-stage breakdown).
Building it:

```bash
docker build -t bond-os .
```

or, for the full local stack (Postgres + Redis + this image, wired together):

```bash
docker compose --profile full up -d --build
```

No other deployment target — no Vercel project file, no Kubernetes manifests, no Terraform/Pulumi
infrastructure code, no cloud-provider-specific config (AWS/GCP/Azure) — exists anywhere in this
repository. The design does deliberately keep the door open to Vercel: the README's own architecture
notes state that Realtime (P9) uses reconnecting SSE rather than a WebSocket server "chosen
specifically to keep the app deployable both as a Docker container and on Vercel without committing to
one always-on process." That is a documented design constraint honored by the code, not a configured
deployment — there is no `vercel.json` and no Vercel-specific build hook in this repo. Deploying to
Vercel (or any other Node host) is architecturally possible but has not been set up here; the Docker
image is the only path that has actually been built and is described in depth below.

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

## Related documents

- [Docker](./docker.md) — the image this section builds and runs, explained stage by stage.
- [Environment Variables](./environment.md) — full reference.
- [Scheduler](../workflows/scheduler.md) — the tick endpoint in full detail.
- [Backups](./backups.md) — what's manual today.
- [Monitoring](./monitoring.md) — what observability exists, and what doesn't.
- [Security: Secrets](../security/secrets.md) — plaintext-at-rest columns and what that means operationally.
- [Architecture: Scalability](../architecture/scalability.md) — the broader scaling picture this document's [Scaling considerations](#scaling-considerations) section is drawn from.
