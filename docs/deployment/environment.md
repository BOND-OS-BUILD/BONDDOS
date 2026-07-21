# Environment Variables

## Scope

Every environment variable BOND OS reads, sourced from two places that must be read together: the
checked-in template `.env.example` (the operator-facing contract — every variable in it is real,
including its comments), and `packages/shared/src/env.ts` (the zod schema that actually validates
`process.env` at boot and is the ground truth for what's required, optional, defaulted, or coerced).
Where the two disagree — a handful of variables `env.ts` validates that `.env.example` doesn't
mention — that's called out explicitly rather than glossed over.

## How environment variables are loaded and validated

`packages/shared/src/env.ts` exports `getEnv()`: a lazily-evaluated, cached, zod-validated read of
`process.env`, importable only from server code (the file starts with `import 'server-only'`, so
importing it from a Client Component is a build-time error). Validation is **eager and fails fast**:

```ts
function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `\n❌ Invalid environment variables:\n${formatted}\n\nCheck your .env file against .env.example.\n`,
    );
  }
  return parsed.data;
}
```

A missing/invalid required variable throws immediately (on first access, since `getEnv()` is called
lazily but the very first server code path that touches config triggers it), with a formatted,
per-field error listing exactly what's wrong — not a generic crash. `env` itself is also exported as a
`Proxy` (`env.DATABASE_URL` reads the same validated, cached value as `getEnv().DATABASE_URL`) for
ergonomic destructuring at call sites.

At the process level, each workspace's scripts load `.env` via `dotenv-cli` explicitly — e.g.
`apps/web/package.json`'s `dev`/`build`/`start` scripts are all `dotenv -e ../../.env -- next ...`, and
`packages/database/package.json`'s `migrate:dev`/`migrate:deploy`/`studio`/`seed` scripts are all
`dotenv -e ../../.env -- prisma ...`. There is exactly one `.env` file, at the repo root, that every
workspace reads from — not a per-package `.env`.

## Reference: every variable in `.env.example`

### Database

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | **Yes** | none — must be a valid `postgres://`/`postgresql://` URL | The Postgres connection string. `.env.example` ships `postgresql://bondos:bondos@localhost:5432/bondos?schema=public`, matching `docker-compose.yml`'s `postgres` service. Must be a database with (or able to create) the `vector` (pgvector) extension — see [Docker](./docker.md#pgvector--a-real-gotcha). |

### Auth (Better Auth)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | Effectively yes | none | Signs sessions. Must resolve (directly or via the fallback below) to a string 16+ characters, or `env.ts` throws at boot. Generate with `openssl rand -base64 32`. |
| `NEXTAUTH_SECRET` | No | none | Legacy alias. `env.ts`'s zod `.transform()` on `BETTER_AUTH_SECRET` falls back to `process.env.NEXTAUTH_SECRET` if `BETTER_AUTH_SECRET` is unset/empty — kept "for compatibility if this project ever moves to Auth.js." Setting only this one still satisfies the requirement above. |

### App URL

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `APP_URL` | No (schema default) | `http://localhost:3000` | The server-side base URL. Used by Better Auth's `baseURL`/`trustedOrigins` (`packages/auth/src/server.ts`) and by `assertSameOrigin()` (`apps/web/lib/csrf.ts`) to validate every mutating request's `Origin` header. **Must exactly match the real deployed origin in production** — see [Production](./production.md#app_url-correctness-the-csrfbetter-auth-trap). |
| `NEXT_PUBLIC_APP_URL` | No | — (no zod default; read directly via `process.env.NEXT_PUBLIC_APP_URL`, not through `env.ts`) | The client-side equivalent — Next.js inlines `NEXT_PUBLIC_*` variables into the browser bundle at build time. `packages/auth/src/client.ts` reads it directly (`process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'`) for Better Auth's client `baseURL`. Keep this identical to `APP_URL`. |

### Storage (Supabase)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SUPABASE_URL` | No | `""` | Supabase project URL, server-side. Without it, upload routes return a clear "Supabase Storage is not configured" error rather than failing silently. See [File Storage](../storage.md). |
| `SUPABASE_KEY` | No | `""` | Should be a service-role or appropriately-scoped key — the upload route runs server-side only and is never exposed to the browser. |
| `NEXT_PUBLIC_SUPABASE_URL` | No | `""` | Client-side Supabase URL (not validated by `env.ts` — read via `NEXT_PUBLIC_*` inlining, same mechanism as `NEXT_PUBLIC_APP_URL`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No | `""` | Client-side anon key, safe to expose to the browser by design (Supabase's own convention). |

To actually enable Storage: create a Supabase project, create a **public** bucket named
`bondos-public` (the exact name `apps/web/lib/supabase.ts` uses — see [File Storage](../storage.md)),
and set all four variables above.

### Cache (Redis)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `REDIS_URL` | No | `""` (unset) | Optional. Unset → `getCache()` uses `InMemoryCache` (fine for local dev and single-instance deploys). Set → `RedisCache`. Does **not** affect the rate limiter or the queue — see [Production: Scaling considerations](./production.md#scaling-considerations). With Docker: `docker compose up -d redis`, then `REDIS_URL="redis://localhost:6379"`. |

### Email (password reset)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SMTP_HOST` | No | `""` | Without any SMTP variable set, outgoing emails (password reset) are logged to the console instead of sent (`packages/auth/src/email.ts`) — useful for local dev, not acceptable for real production users. |
| `SMTP_PORT` | No | `"587"` in `.env.example`; `env.ts` has no numeric default, coerces to a positive int if present | SMTP server port. |
| `SMTP_USER` | No | `""` | SMTP auth username. |
| `SMTP_PASS` | No | `""` | SMTP auth password. |
| `EMAIL_FROM` | No | `"BOND OS <noreply@bondos.dev>"` | The `From` header for outgoing emails; has a schema-level default so it's always set even if omitted. |

### AI Memory & Retrieval — embeddings (Phase 4)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `EMBEDDING_PROVIDER` | No | `"LOCAL"` | One of `LOCAL \| OPENAI \| GEMINI \| VOYAGE \| OLLAMA`. `LOCAL` is a zero-config deterministic fallback — no API key needed to boot retrieval at all. See [ai/embeddings.md](../ai/embeddings.md). |
| `EMBEDDING_MODEL` | No | `""` | Model name override for the selected provider. |
| `EMBEDDING_DIMENSIONS` | No | `"1536"` | Must match the pgvector column's fixed dimension (`vector(1536)` in the schema) — the whole vector index needs one constant dimension. |
| `OPENAI_API_KEY` | No | `""` | Required only if `EMBEDDING_PROVIDER=OPENAI` (or `AI_PROVIDER=OPENAI`). |
| `OPENAI_EMBEDDING_MODEL` | No | `""` | OpenAI-specific embedding model override. |
| `GEMINI_API_KEY` | No | `""` | Required only if `EMBEDDING_PROVIDER=GEMINI`. |
| `VOYAGE_API_KEY` | No | `""` | Required only if `EMBEDDING_PROVIDER=VOYAGE`. |
| `OLLAMA_BASE_URL` | No | `"http://localhost:11434"` | Required only if `EMBEDDING_PROVIDER=OLLAMA` (or `AI_PROVIDER=OLLAMA`); has a schema default so it's always a valid URL even if omitted. |

### AI generation

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AI_PROVIDER` | No | unset (transformed to `undefined`, not a real enum default) | One of `OPENAI \| ANTHROPIC \| GEMINI \| OLLAMA`. **Deliberately has no working zero-config default** — `@bond-os/ai`'s own `package.json` states nothing in this codebase calls `generate()`/`stream()` yet; only `listModels()`/`health()` (the AI Settings page) and `countTokens()` (the Context Builder) are used this phase. See [ai/providers.md](../ai/providers.md). |
| `AI_MODEL` | No | `""` | Model name for the selected `AI_PROVIDER`. |
| `ANTHROPIC_API_KEY` | No | `""` | Required only if `AI_PROVIDER=ANTHROPIC`. |
| `AI_TEMPERATURE` | No | `"0.7"` | Coerced to a number, `0`–`2`. |
| `AI_MAX_TOKENS` | No | `"2048"` | Coerced to a positive integer. |
| `CONTEXT_TOKEN_BUDGET` | No | `"8000"` | Coerced to a positive integer — the token budget the Context Builder assembles retrieved context under before prompting. See [ai/context-builder.md](../ai/context-builder.md). |

`.env.example`'s own comment on this block ends with a reminder that applies to the whole file:

> `NODE_ENV` is intentionally NOT set here — Next.js/Node set it contextually (`development` for
> `next dev`, `production` for `next build`/`next start`). Setting it in a loaded `.env` file overrides
> that and breaks the production build.

See [`NODE_ENV`](#node_env) below.

## Additional variables validated by `env.ts` but absent from `.env.example`

`.env.example` predates several later phases' tunables. These are real, schema-validated environment
variables — `env.ts` will happily coerce/validate them if set, and every one has a working default, so
omitting them (as `.env.example` currently does) is not a functional gap, just a documentation gap in
the template file itself. Listed here so an operator who wants to tune them knows they exist:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOND_MAX_TOOL_CALLS` | `3` | Phase 5 — max tool calls Mr. Bond can make in a single turn. |
| `MEMORY_RETENTION_DAYS` | `90` | Phase 5 — how long conversation memory is retained. |
| `APPROVAL_EXPIRY_MINUTES` | `15` | Phase 6 — how long an `ApprovalRequest` stays `PENDING` before `expireStaleApprovalRequests` flags it `EXPIRED`. See [Approval Engine](../security/approvals.md). |
| `AGENT_MAX_DELEGATION_DEPTH` | `3` | Phase 7 — depth backstop on top of `DelegationBudget.visitedAgentKeys`'s own cycle detection, bounding long acyclic delegation chains. See [Agents: Delegation](../agents/delegation.md). |
| `WORKFLOW_MAX_SYNC_STEPS` | `20` | Phase 8 — bounds one event's total synchronous dispatch chain through `publishEvent()`. |
| `WORKFLOW_MAX_SYNC_MS` | `5000` | Phase 8 — same bound, expressed as a time budget (max `30000`). |
| `CRON_SECRET` | none — `optional().or(z.literal(''))`, deliberately no default | Phase 8 — the shared-secret bearer token `POST /api/workflows/schedule/tick` requires. An unset value is a valid, expected state (the route fails closed with `404`), not a validation error. See [Scheduler](../workflows/scheduler.md). |

## `LOG_LEVEL` — an unvalidated escape hatch

`packages/shared/src/logger.ts` reads `process.env.LOG_LEVEL` directly:

```ts
level: process.env.LOG_LEVEL ?? (isProd() ? 'info' : 'debug'),
```

This is the **one** environment variable in the codebase read outside `env.ts`'s zod schema entirely —
it is not validated, not listed in `.env.example`, and not typed. Any string pino's `level` accepts
(`trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`) works; anything else is passed straight
to pino, which will throw its own error at logger construction time rather than `env.ts`'s formatted
one. Default is `info` in production, `debug` otherwise.

## `NODE_ENV`

Deliberately absent from both `.env` and `.env.example` by convention, not by oversight. Node/Next.js
set it contextually — `development` for `next dev`, `production` for `next build`/`next start`. If a
loaded `.env` file sets it explicitly, that value **overrides** Next's own contextual setting, which:

1. Triggers a Next.js warning ("non-standard `NODE_ENV` value").
2. Can break a production build outright: `packages/shared/src/logger.ts` only enables pino's
   pretty-print transport (`pino-pretty`, which spawns a worker thread) when `NODE_ENV !== 'production'`
   — a stale `development` value present during what should be a production build makes the logger try
   to spin up that transport mid-build, which fails.

`env.ts`'s own schema does default `NODE_ENV` to `'development'` if literally unset in `process.env`
at all (`z.enum([...]).default('development')`), but the Dockerfile's `runner` stage sets it explicitly
via `ENV NODE_ENV=production` (see [Docker](./docker.md#stage-4--runner)) — the one deliberate
exception, since that's a Docker `ENV` instruction affecting the container's `process.env` directly,
not a value loaded from a tracked `.env` file.

## Related documents

- [Local Development](./local.md) — the minimal set to get running locally.
- [Production](./production.md) — which of these matter most for a real deploy, and the `APP_URL` trap in full.
- [Docker](./docker.md) — how `docker-compose.yml` overrides `DATABASE_URL`/`REDIS_URL` for the containerized `web` service.
- [Security: Secrets](../security/secrets.md) — which of these values are secrets, and how (or whether) they're protected at rest.
