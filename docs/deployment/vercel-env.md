# Vercel Environment Variables

## Scope

Every environment variable BOND OS reads, sourced directly from `packages/shared/src/env.ts`'s zod
schema (the authoritative, validated set — `getEnv()`/`env` throws a formatted error listing every
missing/invalid required field on first access if this isn't satisfied), `.env.example`, and a direct
grep for `process.env.NEXT_PUBLIC_*` client-side usage. No secret values are included below — every
"Example value" for an actual secret is either omitted or shown only as a format placeholder. Set
these under **Vercel Project Settings → Environment Variables**, scoped to whichever of
Production/Preview/Development environments need them (Production at minimum for everything marked
Required).

## Required

| Variable | Description | Required / Optional | Example value | Depends on |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Must point at a database with the `vector` (pgvector) extension available — see [pgvector — a real gotcha](./docker.md#pgvector--a-real-gotcha). | **Required** | `postgresql://user:password@host:5432/dbname?schema=public&sslmode=require` | Prisma / every feature (the entire application). |
| `BETTER_AUTH_SECRET` | Random secret Better Auth signs sessions with. Must be ≥16 characters. Rotating it invalidates every existing session. `NEXTAUTH_SECRET` is accepted as a legacy fallback name if set instead. | **Required** | *(leave empty — generate with `openssl rand -base64 32`, set only in Vercel's dashboard)* | Authentication (Better Auth), every authenticated route. |
| `APP_URL` | The exact, real origin (scheme + host, no trailing slash) the app is served from. Checked by `assertSameOrigin()`'s CSRF defense and Better Auth's `trustedOrigins` — a mismatch here makes every mutating request fail with `403 Cross-origin request rejected` while pages still load normally. See [Production: `APP_URL` correctness](./production.md#app_url-correctness-the-csrfbetter-auth-trap). | **Required** | `https://your-project.vercel.app` (or your custom domain) | CSRF defense, Better Auth, any absolute-URL construction. |
| `NEXT_PUBLIC_APP_URL` | Client-side counterpart of `APP_URL` — inlined into the browser bundle at build time (Next.js `NEXT_PUBLIC_*` convention). Must match `APP_URL` exactly. Used directly by `packages/auth/src/client.ts` as the Better Auth client's `baseURL`. | **Required** | `https://your-project.vercel.app` | Better Auth client (`packages/auth/src/client.ts`), any client-side absolute-URL construction. |

## Optional — with a working fallback

| Variable | Description | Required / Optional | Example value | Depends on |
| --- | --- | --- | --- | --- |
| `SUPABASE_URL` | Supabase project URL. Without it, avatar/organization-logo uploads and comment attachments return a clear "Supabase Storage is not configured" error; everything else works normally. | Optional | `https://your-project.supabase.co` | `apps/web/lib/supabase.ts` (file uploads). |
| `SUPABASE_KEY` | Supabase service-role or anon key paired with `SUPABASE_URL`. | Optional | *(leave empty — a real secret)* | Same as `SUPABASE_URL`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Declared in `.env.example` and `turbo.json`'s `globalEnv`, but **not currently read by any code path** (grep-confirmed — no `process.env.NEXT_PUBLIC_SUPABASE_URL` reference exists in the codebase today). A known, pre-existing, harmless discrepancy — stated here rather than silently omitted. | Optional (currently unused) | `https://your-project.supabase.co` | None (unused today). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same status as `NEXT_PUBLIC_SUPABASE_URL` — declared but not currently read anywhere in the codebase. | Optional (currently unused) | *(leave empty)* | None (unused today). |
| `REDIS_URL` | Enables `RedisCache` (shared, cross-instance caching and per-channel SSE snapshot dedup) in place of the default `InMemoryCache` (per-instance only). Vercel's serverless functions are ephemeral/multi-instance by nature, so setting this is meaningfully more valuable on Vercel than in a single-container deploy — without it, cache/dedup benefit resets on every cold start and doesn't share across concurrent invocations. Does **not** affect rate limiting — see [Architecture: Scalability](../architecture/scalability.md#cache-in-memory-by-default-genuinely-optional-redis) for the documented gap (no Redis-backed `RateLimiter` exists). | Optional (recommended for production) | `rediss://default:password@host:6379` | `packages/shared/src/cache.ts` (`getCache()`), Collaboration SSE channel snapshot dedup. |
| `SMTP_HOST` | Outbound mail server host. Without SMTP configured, password-reset emails are logged to the function's stdout instead of sent — **not visible to real users on Vercel** the way a local terminal is, so this is effectively required for a real production deployment even though the schema marks it optional. | Optional (practically required for real users) | `smtp.sendgrid.net` | `packages/auth/src/email.ts` (password-reset flow). |
| `SMTP_PORT` | SMTP port. | Optional | `587` | Same as `SMTP_HOST`. |
| `SMTP_USER` | SMTP auth username. | Optional | `apikey` | Same as `SMTP_HOST`. |
| `SMTP_PASS` | SMTP auth password/API key. | Optional | *(leave empty — a real secret)* | Same as `SMTP_HOST`. |
| `EMAIL_FROM` | From-address for outgoing email. Has a working default. | Optional | `BOND OS <noreply@yourdomain.com>` | Same as `SMTP_HOST`. |
| `CRON_SECRET` | Shared bearer secret `POST /api/workflows/schedule/tick` requires, compared via `crypto.timingSafeEqual`. Unset by default — the route fails closed with `404` (not `401`/`403`, deliberately, so an unauthenticated prober can't tell the endpoint exists). **Must be set for any `SCHEDULED`-trigger workflow or `WAIT`/`DELAY` step to ever fire** — see [Vercel Cron below](#wiring-the-scheduler-vercel-cron). | Optional (required if using scheduled workflows) | *(leave empty — generate a random secret)* | `POST /api/workflows/schedule/tick` (the Workflow Scheduler's only external trigger). |

## Optional — AI / embeddings (all have zero-config fallbacks)

| Variable | Description | Required / Optional | Example value | Depends on |
| --- | --- | --- | --- | --- |
| `EMBEDDING_PROVIDER` | One of `LOCAL \| OPENAI \| GEMINI \| VOYAGE \| OLLAMA`. `LOCAL` (the default) is a zero-config deterministic fallback — retrieval/RAG works with no key set at all. | Optional | `LOCAL` | `packages/embeddings` provider selection. |
| `EMBEDDING_MODEL` | Model name override for the selected provider. | Optional | *(blank — provider default)* | Same as `EMBEDDING_PROVIDER`. |
| `EMBEDDING_DIMENSIONS` | Must match the pgvector column's fixed dimension (`vector(1536)` in the schema). | Optional | `1536` | pgvector schema / embeddings table. |
| `OPENAI_API_KEY` | Required only if `EMBEDDING_PROVIDER=OPENAI` or `AI_PROVIDER=OPENAI`. | Optional | *(leave empty — a real secret)* | OpenAI embedding/AI provider. |
| `OPENAI_EMBEDDING_MODEL` | OpenAI-specific embedding model override. | Optional | `text-embedding-3-small` | Same as `OPENAI_API_KEY`. |
| `GEMINI_API_KEY` | Required only if `EMBEDDING_PROVIDER=GEMINI`. | Optional | *(leave empty — a real secret)* | Gemini embedding provider. |
| `VOYAGE_API_KEY` | Required only if `EMBEDDING_PROVIDER=VOYAGE`. | Optional | *(leave empty — a real secret)* | Voyage embedding provider. |
| `OLLAMA_BASE_URL` | Required only if `EMBEDDING_PROVIDER=OLLAMA` or `AI_PROVIDER=OLLAMA`. Has a schema default. **Not reachable from Vercel's serverless functions unless Ollama is hosted somewhere network-accessible to Vercel** — a `localhost` value only works in local dev. | Optional | `http://localhost:11434` (local dev only) | Ollama embedding/AI provider. |
| `AI_PROVIDER` | One of `OPENAI \| ANTHROPIC \| GEMINI \| OLLAMA`. Deliberately has no working zero-config default — `@bond-os/ai` is infrastructure-only as of this writing (nothing calls `generate()`/`stream()` yet); only `listModels()`/`health()` and `countTokens()` are exercised. Safe to leave unset. | Optional | *(blank)* | `@bond-os/ai` provider abstraction (AI Settings page, Context Builder token counting). |
| `AI_MODEL` | Model name for the selected `AI_PROVIDER`. | Optional | *(blank)* | Same as `AI_PROVIDER`. |
| `ANTHROPIC_API_KEY` | Required only if `AI_PROVIDER=ANTHROPIC`. | Optional | *(leave empty — a real secret)* | Anthropic provider. |
| `AI_TEMPERATURE` | Coerced to a number, `0`–`2`. | Optional | `0.7` | `@bond-os/ai` provider config. |
| `AI_MAX_TOKENS` | Coerced to a positive integer. | Optional | `2048` | `@bond-os/ai` provider config. |
| `CONTEXT_TOKEN_BUDGET` | Token budget the Context Builder assembles retrieved context under. | Optional | `8000` | Mr. Bond's Context Builder. |

## Optional — phase-specific tunables (all have working defaults)

| Variable | Description | Required / Optional | Example value | Depends on |
| --- | --- | --- | --- | --- |
| `BOND_MAX_TOOL_CALLS` | Max tool calls Mr. Bond can make in a single turn. | Optional | `3` | Mr. Bond chat pipeline. |
| `MEMORY_RETENTION_DAYS` | How long conversation memory is retained. | Optional | `90` | Conversation memory. |
| `APPROVAL_EXPIRY_MINUTES` | How long an `ApprovalRequest` stays `PENDING` before being flagged `EXPIRED`. | Optional | `15` | Tool Execution Framework's Approval Engine. |
| `AGENT_MAX_DELEGATION_DEPTH` | Depth backstop on agent-to-agent delegation chains. | Optional | `3` | Multi-Agent delegation. |
| `WORKFLOW_MAX_SYNC_STEPS` | Bounds one event's total synchronous dispatch chain through `publishEvent()`. | Optional | `20` | Workflow Engine dispatch budget. |
| `WORKFLOW_MAX_SYNC_MS` | Same bound, expressed as a time budget (max `30000`). | Optional | `5000` | Workflow Engine dispatch budget. |

## Not a `.env` variable: `NODE_ENV`

**Do not set `NODE_ENV` in Vercel's Environment Variables UI.** Vercel/Next.js set it contextually
(`production` for the build and deployed function runtime), and a manually-set value can override
that in ways that break the build — see
[Troubleshooting: `NODE_ENV` set in `.env` breaks the production build](./troubleshooting.md#node_env-set-in-env-breaks-the-production-build).
This applies to Vercel's env var UI exactly as it does to a local `.env` file.

## Wiring the scheduler: Vercel Cron

BOND OS has no background worker process — time-based workflow execution (`SCHEDULED` triggers,
`WAIT`/`DELAY` step resumption) only happens when something external calls
`POST /api/workflows/schedule/tick` with `Authorization: Bearer <CRON_SECRET>`. On Vercel, the
natural fit is [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) — add a `crons` entry to
`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/workflows/schedule/tick", "schedule": "*/5 * * * *" }
  ]
}
```

Vercel Cron invokes the path with a `GET` request and its own internal auth
(`Authorization: Bearer $CRON_SECRET` is NOT automatically attached by Vercel Cron the way it is for
Vercel's own first-party integrations) — since this route is a `POST` and expects a manually-verified
bearer token, either front it with a `GET`-to-`POST` shim, switch this specific route to also accept
`GET`, or use an external scheduler (GitHub Actions on a schedule, an OS-level cron job hitting the
URL) instead. This is a real, non-trivial wiring detail worth flagging rather than assuming
`vercel.json`'s `crons` key alone is sufficient — see [Scheduler](../workflows/scheduler.md) for the
full mechanism and its three documented external-caller options.

## Related documents

- [Environment Variables](./environment.md) — the full reference (mirrors this document's variable
  set, framed for any deployment target, not just Vercel).
- [Production](./production.md) — the `APP_URL`/CSRF trap in full, and the pre-deploy checklist.
- [Secrets Management](../security/secrets.md) — what's plaintext at rest and why.
- [Scheduler](../workflows/scheduler.md) — the tick endpoint this document's Cron section wires up.
