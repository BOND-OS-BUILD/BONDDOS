# BOND OS — Final Production Deployment Guide

This is the single, complete, follow-along guide for taking BOND OS from its current state (deployed
to Vercel, reachable, routing correctly, but with no production database or secrets) to fully
operational in production. Every step below was either already completed and verified, or is stated
precisely enough to complete without guesswork. Nothing here fabricates a credential, invents a
service the codebase doesn't actually use, or assumes infrastructure that hasn't been created — where
something requires you to create an account or generate a secret, that's stated as a manual step, not
worked around.

For deeper technical detail behind any step, see [`docs/deployment/production.md`](docs/deployment/production.md)
(the full production-deployment reference), [`docs/deployment/vercel-env.md`](docs/deployment/vercel-env.md)
(every environment variable in depth), and [`docs/deployment/troubleshooting.md`](docs/deployment/troubleshooting.md).

---

## 1. Current Deployment Status

| Item | Status |
| --- | --- |
| GitHub repository | `BOND-OS-BUILD/BONDDOS`, branch `main`, clean, synced |
| Latest commit | See `git log -1` at the time you read this — this guide was generated at commit `2679a44` and finalized in the commit that added this file |
| Version tag | `v1.0.0` — "BOND OS Foundation Documentation Complete" |
| Vercel project | `bond-oss-projects/bond-os` — [https://bond-os-olive.vercel.app](https://bond-os-olive.vercel.app) |
| Vercel ↔ GitHub integration | **Connected.** `productionBranch: "main"` — pushing to `main` now triggers an automatic production deployment; PRs trigger preview deployments. |
| Root Directory | `apps/web` (correct — verified) |
| Framework Preset | Next.js (auto-detected) |
| Build | ✅ Succeeds on Vercel's infrastructure — all 123 routes compile, Prisma Client and its Linux query-engine binary are correctly generated and bundled (see the 3 fixes in commit `2679a44`) |
| Environment variables on Vercel | **0 set** — none fabricated, per instruction |
| Production database | **Does not exist yet** |
| Routing / middleware | ✅ Verified healthy — static pages return `200`, auth-gated pages correctly `307`-redirect to `/login` |
| Database-dependent routes | Currently `500` (generic error, no leaked detail) — expected, since no `DATABASE_URL` is set |

**In one sentence: the application is built and deployed correctly; it is waiting entirely on you creating a production database and a small set of secrets.**

---

## 2. Remaining Blockers

There is really **one root blocker**, not several — every "waiting" item in the readiness matrix
(§9) traces back to it:

- **No production PostgreSQL database exists.** Nothing else can be verified end-to-end until this is
  created, migrated, and its connection string is set as `DATABASE_URL`.

Two secondary items, independent of the database:

- **No `BETTER_AUTH_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL` set** — required regardless of which
  database provider you choose.
- **No Supabase Storage bucket** — optional; file uploads (avatars, logos, document/comment
  attachments) fail with a clear, non-crashing error until this exists.

Everything else (Redis, SMTP, AI provider keys) is genuinely optional with a working, documented
fallback — see §8 and [`vercel-env.md`](docs/deployment/vercel-env.md).

---

## 3. Exact Services to Create

Only services the codebase actually integrates with are listed — nothing here is speculative.

| # | Service | Required? | What it's for | Recommended provider |
| --- | --- | --- | --- | --- |
| 1 | PostgreSQL with the `vector` (pgvector) extension | **Required** | The entire application's data store — every feature (auth, company data, knowledge graph, search, workflows, collaboration) reads/writes here | **Supabase** (bundles Storage too — one account covers both #1 and #2) |
| 2 | Object storage (Supabase Storage specifically — the codebase calls `@supabase/supabase-js`'s Storage API directly, not a generic S3 client) | Optional, recommended | Avatar/logo images, document and comment attachments | **Supabase** (same project as #1) |
| 3 | Redis | Optional | Shared cache + realtime SSE snapshot dedup across serverless function instances; without it, falls back to a working per-instance in-memory cache | **Upstash** (via Vercel Marketplace — native integration, TCP-Redis-compatible, matches the codebase's `ioredis` client) |
| 4 | SMTP provider | Optional, recommended | Password-reset emails; without it, reset links are only logged server-side (invisible to real users on Vercel) | Any standard SMTP provider (Resend, SendGrid, Postmark, Mailgun, etc.) — the codebase uses generic SMTP, not a provider-specific SDK |
| — | Authentication provider | **None needed** | Better Auth is self-hosted in-app (email/password only, no OAuth/social providers configured) — it uses your Postgres database directly, no separate account |

---

## 4. Exact Environment Variables

The definitive list. Full detail (every optional/tunable variable, AI/embedding provider keys, etc.)
is in [`docs/deployment/vercel-env.md`](docs/deployment/vercel-env.md) — this table is the set you
actually need to reach a fully working production deployment.

| Name | Purpose | Example | Required/Optional | Where to obtain it |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; must support the `vector` extension | `postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres` | **Required** | Supabase → Project Settings → Database → Connection string (or your chosen provider's equivalent) |
| `BETTER_AUTH_SECRET` | Signs and verifies session tokens | *(random string, 32+ chars — do not use the example)* | **Required** | Generate yourself — see §6 |
| `APP_URL` | Server-side: the app's real origin, used for CSRF/session-trust checks | `https://bond-os-olive.vercel.app` | **Required** | The Vercel production URL (already known — see §1), or your custom domain once attached |
| `NEXT_PUBLIC_APP_URL` | Client-side counterpart of `APP_URL`, inlined into the browser bundle | `https://bond-os-olive.vercel.app` | **Required** | Same value as `APP_URL`, always |
| `SUPABASE_URL` | Supabase project URL, for Storage | `https://xxxx.supabase.co` | Optional (needed for uploads) | Supabase → Project Settings → API → Project URL |
| `SUPABASE_KEY` | Supabase **service_role** secret key — server-only code needs elevated storage permissions, not the anon key | *(service_role secret — treat as highly sensitive)* | Optional (needed for uploads) | Supabase → Project Settings → API → `service_role` secret |
| `REDIS_URL` | Enables shared caching across serverless instances | `rediss://default:PASSWORD@xxxx.upstash.io:6379` | Optional | Upstash (via Vercel Marketplace or upstash.com) → your database → "Redis Connect" TCP URL |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Outbound mail for password-reset | `smtp.resend.com` / `587` / ... | Optional (recommended) | Your SMTP provider's dashboard |
| `EMAIL_FROM` | From-address for outgoing email | `BOND OS <noreply@yourdomain.com>` | Optional (has a default) | Your own domain/provider |
| `CRON_SECRET` | Authenticates `POST /api/workflows/schedule/tick` | *(random string you generate)* | Optional (only if using scheduled workflows) | Generate yourself, same method as `BETTER_AUTH_SECRET` |

**Do not fabricate any of these** — every blank/example value above must be replaced with a real value
from an account you control before the app is functional.

---

## 5. Database — Step-by-Step Setup Guide (Supabase, recommended)

No production database exists yet. This does not block anything else in this guide — follow these
steps in order.

### 5.1 Create a Supabase account and project

1. Go to [supabase.com](https://supabase.com) and sign up (or sign in).
2. **New Project** → choose an organization → name it (e.g. `bond-os-production`) → set a strong
   database password (save it — you'll need it for `DATABASE_URL`) → choose a region close to
   Vercel's deployment region (`iad1` / US East, per the build logs in §1, unless you've changed it)
   → **Create new project**. Provisioning takes a minute or two.

### 5.2 Enable the `vector` extension

1. In the Supabase dashboard: **Database** → **Extensions**.
2. Search for `vector` and toggle it **on**. This is the pgvector extension the schema requires
   (`extensions = [vector]` in `packages/database/prisma/schema.prisma`).

### 5.3 Get the connection string

1. **Project Settings** → **Database** → **Connection string** → select **URI** format, and use the
   **Connection pooling** string (port `6543`, Supavisor pooler) rather than the direct connection
   (port `5432`) — Vercel's serverless functions open many short-lived connections, which a
   non-pooled Postgres connection limit will exhaust quickly.
2. It looks like:
   `postgresql://postgres.xxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`
3. Replace `[YOUR-PASSWORD]` with the database password from step 5.1. This full string is your
   `DATABASE_URL`.

### 5.4 Run the Prisma migration

From your local machine (with this repository checked out and dependencies installed):

```bash
DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres" \
  pnpm --filter @bond-os/database run migrate:deploy
```

This runs `prisma migrate deploy` — applies the one existing migration
(`packages/database/prisma/migrations/20260718000000_init/`, the full 67-model/46-enum schema)
non-interactively. This is the **first time this migration has ever been applied to a live
database** — the schema was originally authored and validated offline (see
[Troubleshooting: No live Postgres in some dev sandboxes](docs/deployment/troubleshooting.md#no-live-postgres-in-some-dev-sandboxes)).
If it fails, the error will point at the specific statement — see §11 Troubleshooting below for the
one known category of first-run failure (a missing extension).

### 5.5 Verify

```bash
DATABASE_URL="<same connection string>" pnpm --filter @bond-os/database run studio
```

Opens Prisma Studio against the production database — confirm the 67 tables exist and are empty. Close
it when done (don't leave Prisma Studio open against production).

### 5.6 Set `DATABASE_URL` on Vercel and redeploy

```bash
vercel env add DATABASE_URL production
# paste the connection string from step 5.3 when prompted
vercel deploy --prod
```

(Environment variables are baked into each deployment — adding one requires a new deployment to take
effect. Since Git integration is now connected, pushing any commit to `main` also triggers this.)

---

## 6. Better Auth — Secret and URLs

Better Auth is **self-hosted** in this codebase (`packages/auth/src/server.ts`) — email/password only,
no social/OAuth providers configured, so **there are no third-party OAuth callback URLs to register
anywhere.** The only configuration it needs is its own secret and the app's real URL.

### 6.1 Generate `BETTER_AUTH_SECRET`

Run **one** of these on your own machine (never paste a secret into a chat or a file you'll commit):

```bash
openssl rand -base64 32
```

If `openssl` isn't available:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Either produces a random 44-character base64 string. Set it as `BETTER_AUTH_SECRET` — see §5.6's
pattern (`vercel env add BETTER_AUTH_SECRET production`).

### 6.2 "Callback URLs"

Not applicable in the OAuth sense — there is no external identity provider to register a redirect URL
with. Better Auth's own internal endpoints are all mounted at `/api/auth/*`
(`apps/web/app/api/auth/[...all]/route.ts`) and become reachable automatically once `APP_URL` is set
correctly — no separate registration step.

### 6.3 Production URLs

```
APP_URL=https://bond-os-olive.vercel.app
NEXT_PUBLIC_APP_URL=https://bond-os-olive.vercel.app
```

Both must be set to the **exact** real origin — scheme (`https://`), host, no trailing slash. If you
later attach a custom domain, update both of these to the custom domain and redeploy — see
[Production: `APP_URL` correctness](docs/deployment/production.md#app_url-correctness-the-csrfbetter-auth-trap)
for exactly what breaks (silently) if these are wrong.

---

## 7. Storage — Supabase Storage Setup Guide

The codebase calls `@supabase/supabase-js`'s Storage API directly
(`apps/web/lib/supabase.ts`) — it requires a **specific, exact bucket name**, not an arbitrary one.

1. In the same Supabase project as §5 (or a separate one, if you prefer to isolate storage from the
   database): **Storage** → **New bucket**.
2. Name it **exactly** `bondos-public` (hardcoded in `apps/web/lib/supabase.ts`).
3. Set it to **Public** (the app calls `getPublicUrl()` for avatars/logos and expects public read
   access; sensitive downloads use a separately-generated signed URL, not bucket-level privacy).
4. **Project Settings** → **API** → copy the **Project URL** (→ `SUPABASE_URL`) and the **`service_role`
   secret** (→ `SUPABASE_KEY` — **not** the `anon` public key; server-only code needs the elevated
   permissions the service role has).
5. Set both on Vercel and redeploy, same pattern as §5.6.

If you skip this: avatar/logo uploads and comment attachments return a clear "Supabase Storage is not
configured" error to the user; nothing else in the app is affected.

---

## 8. Redis — Optional

**Redis is optional.** The codebase's `Cache` abstraction (`packages/shared/src/cache.ts`) works
correctly with no Redis at all, falling back to `InMemoryCache` — this is a real, working, non-degraded
default, not a stub. Set `REDIS_URL` only if you want caching and SSE-channel snapshot deduplication
shared **across** Vercel's multiple serverless function instances rather than reset per cold start.

If you want it, exact setup (Upstash, via Vercel's own Marketplace — the lowest-friction path since it
auto-injects the env var):

1. Vercel Dashboard → your project → **Storage** tab → **Create Database** → **Upstash** → **Redis**.
2. Follow the prompts to create a database and connect it to the `bond-os` project — Vercel
   automatically sets the connection env var(s) for you.
3. Upstash exposes both a REST API and a standard TCP Redis endpoint — this codebase uses `ioredis`
   (a standard TCP Redis client), so confirm the env var Vercel injects is the **TCP/Redis** connection
   string (`redis://` or `rediss://`), not the REST URL, and rename/alias it to `REDIS_URL` if Vercel's
   integration names it something else (check what variable name the integration actually creates
   after connecting, in Project Settings → Environment Variables).

Without it: caching and collaboration-channel dedup work per-instance only — a real, already-documented
architectural characteristic (see
[Architecture: Scalability](docs/architecture/scalability.md#cache-in-memory-by-default-genuinely-optional-redis)),
not a deployment defect.

---

## 9. Production Readiness Matrix

| Area | Status | Why |
| --- | --- | --- |
| Authentication | **Waiting for infrastructure** | Fully coded (Better Auth, email/password). Needs `DATABASE_URL` + `BETTER_AUTH_SECRET` + `APP_URL`/`NEXT_PUBLIC_APP_URL`. |
| Database | **Waiting for infrastructure** | No production database exists — see §5. |
| Storage | **Waiting for infrastructure** | Fully coded, gracefully degrades until `SUPABASE_URL`/`SUPABASE_KEY` + the `bondos-public` bucket exist — see §7. |
| Search | **Waiting for infrastructure** | Hybrid full-text + pgvector search, entirely backed by the same Postgres database as everything else — no separate service. |
| AI | **Waiting for infrastructure** (embeddings) / **Not built** (generation) | Embeddings use a zero-config local provider by default (no external key needed) once the database exists. Real AI text-generation was never implemented in this codebase (`@bond-os/ai` is infrastructure-only, confirmed in its own `package.json` description) — this is a pre-existing application-scope boundary, not a deployment issue. |
| Knowledge Graph | **Waiting for infrastructure** | Postgres-backed, same database. |
| Workflows | **Waiting for infrastructure** | Core engine is Postgres-backed. Scheduled (`SCHEDULED`-trigger) workflows additionally need `CRON_SECRET` set and an external caller wired to `POST /api/workflows/schedule/tick` — see [`vercel-env.md`](docs/deployment/vercel-env.md#wiring-the-scheduler-vercel-cron) for the Vercel Cron `GET`-vs-`POST` caveat if you want this. |
| Collaboration | **Waiting for infrastructure** | Postgres-backed (comments, notifications, presence, spaces). Realtime SSE works without Redis; benefits from it under multi-instance load — see §8. |

**Nothing is Blocked.** Every area is fully implemented and code-complete; every "Waiting for
infrastructure" traces back to §2's one root blocker (no production database) plus, for
Storage/Redis/SMTP specifically, their own optional service.

---

## 10. Exact Deployment Steps (Summary)

1. Create a Supabase project, enable `vector` (§5.1–5.2).
2. Get the pooled connection string (§5.3).
3. Run `pnpm --filter @bond-os/database run migrate:deploy` against it (§5.4).
4. Generate `BETTER_AUTH_SECRET` locally (§6.1).
5. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL` on Vercel
   (`vercel env add <NAME> production`, or Project Settings → Environment Variables in the dashboard).
6. (Optional) Create the `bondos-public` Supabase Storage bucket, set `SUPABASE_URL`/`SUPABASE_KEY`
   (§7).
7. (Optional) Connect Upstash Redis via Vercel Marketplace, set `REDIS_URL` (§8).
8. (Optional) Set `SMTP_*`/`EMAIL_FROM` for real password-reset email.
9. Redeploy: `vercel deploy --prod`, or push any commit to `main` (Git integration is connected and
   will deploy automatically).
10. Run through §12's verification checklist against the live production URL.

---

## 11. Migration Commands (Reference)

```bash
# First-time production migration (run once, after the database + vector extension exist):
DATABASE_URL="<production connection string>" pnpm --filter @bond-os/database run migrate:deploy

# Any future schema change, after adding a new migration locally with `pnpm db:migrate`:
DATABASE_URL="<production connection string>" pnpm --filter @bond-os/database run migrate:deploy

# Schema-only validation (no DB connection required — safe to run anytime):
pnpm --filter @bond-os/database run validate
```

`migrate:deploy` (`prisma migrate deploy`) only ever applies existing, already-committed migrations —
it never generates a new one and never prompts interactively, which is why it's the correct command
for a non-interactive production context (as opposed to `prisma migrate dev`, used locally).

---

## 12. Verification Checklist

Run through this against the live production URL after completing §10:

- [ ] `curl -I https://bond-os-olive.vercel.app/` → `200`
- [ ] `curl -I https://bond-os-olive.vercel.app/dashboard` → `307` redirect to `/login` (unauthenticated)
- [ ] Sign up for a real account at `/signup` — confirm it succeeds (this exercises `DATABASE_URL` +
      `BETTER_AUTH_SECRET` together for the first time)
- [ ] Sign in, land on `/dashboard` — confirm the org/workspace auto-created during signup is visible
- [ ] Create a Project/Task/Document — confirm it persists (reload the page)
- [ ] Upload an avatar or organization logo (if Storage is configured) — confirm it succeeds and the
      image renders
- [ ] Use the search page (`/search`) — confirm results return with no error
- [ ] Open the Knowledge Graph (`/graph`) — confirm it renders with no error
- [ ] Create a workflow (`/workflows`) — confirm the builder loads and a manual "Run Now" trigger
      completes
- [ ] Open the Inbox/Activity Feed (`/inbox`) — confirm it loads with no error
- [ ] `pnpm --filter @bond-os/database run validate`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all
      still pass locally (confirms nothing in this guide required a code change)

If Deployment Protection is still enabled and blocking automated checks, see
[Smoke testing after a Vercel deploy](docs/deployment/production.md#smoke-testing-after-a-vercel-deploy)
for the Protection Bypass for Automation mechanism.

---

## 13. Troubleshooting Guide

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every page loads but every API call returns a generic `500` | One or more required env vars (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_URL`) missing or invalid | Re-check §4's table against what's actually set on Vercel (`vercel env ls`) |
| `prisma migrate deploy` fails on `CREATE EXTENSION IF NOT EXISTS "vector"` | The `vector` extension wasn't enabled before migrating | Go back to §5.2 — enable it in the Supabase dashboard, then re-run the migration |
| Pages load, reads work, but every `POST`/`PATCH`/`DELETE` fails with `403 Cross-origin request rejected` | `APP_URL`/`NEXT_PUBLIC_APP_URL` don't exactly match the real deployed origin | Set both to the exact URL (scheme + host, no trailing slash) shown in the Vercel dashboard, redeploy — full mechanism in [Production: `APP_URL` correctness](docs/deployment/production.md#app_url-correctness-the-csrfbetter-auth-trap) |
| Database connections exhausted / intermittent connection errors under load | Using Supabase's **direct** connection (port `5432`) instead of the **pooled** one (port `6543`) | Re-copy the connection string using the "Connection pooling" option in Supabase (§5.3) |
| File upload returns "Supabase Storage is not configured" | `SUPABASE_URL`/`SUPABASE_KEY` not set, or the `bondos-public` bucket doesn't exist | Complete §7 |
| Scheduled workflows never fire | `CRON_SECRET` unset, or no external caller is wired to `POST /api/workflows/schedule/tick` (this is by design — there is no background worker in this codebase) | See [Scheduler](docs/workflows/scheduler.md) and [`vercel-env.md`](docs/deployment/vercel-env.md#wiring-the-scheduler-vercel-cron) for the Vercel Cron caveat |
| A fresh `git clone` fails to build on Windows at "Collecting build traces" | The well-known, pre-existing, Vercel-irrelevant Windows symlink-privilege limitation | See [Troubleshooting](docs/deployment/troubleshooting.md#windows-next-build-eperm-symlink-error) — does not affect Vercel's Linux build |
| Need to roll back a bad production deploy | — | `vercel rollback`, or promote a prior deployment from the dashboard — see [Rollback process](docs/deployment/production.md#rollback-process). Does **not** revert a database migration; handle schema reversal separately if one shipped with the bad deploy |

---

## Related documents

- [`docs/deployment/production.md`](docs/deployment/production.md) — the full production deployment reference (Docker + Vercel).
- [`docs/deployment/vercel-env.md`](docs/deployment/vercel-env.md) — every environment variable in depth.
- [`docs/deployment/troubleshooting.md`](docs/deployment/troubleshooting.md) — the full troubleshooting reference.
- [`docs/architecture/scalability.md`](docs/architecture/scalability.md) — what does and doesn't horizontally scale today.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the verification gate every code change goes through.
