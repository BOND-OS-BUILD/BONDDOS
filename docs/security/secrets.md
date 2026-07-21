# Secrets Management

## Scope

This document covers every secret and credential in BOND OS: where it's declared, how it's
validated, how it reaches a running process, and — as plainly as the rest of this documentation
set — where the current setup has gaps. It is grounded directly in `packages/shared/src/env.ts`
(the single source of truth for what environment variables exist and how they're validated),
`.env.example` (the checked-in template), `.gitignore`, and the runtime code that actually reads
each secret.

## The pattern: `getEnv()` — fail-fast, server-only, validated once

```ts
import 'server-only';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres:// connection string.'),
  BETTER_AUTH_SECRET: z.string().min(1).optional().or(z.literal('')).transform((value, ctx) => {
    const fallback = process.env.NEXTAUTH_SECRET;
    const resolved = value || fallback;
    if (!resolved || resolved.length < 16) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BETTER_AUTH_SECRET (or legacy NEXTAUTH_SECRET) must be set to a random string of at least 16 characters.' });
      return z.NEVER;
    }
    return resolved;
  }),
  // ...
});

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`).join('\n');
    throw new Error(`\n❌ Invalid environment variables:\n${formatted}\n\nCheck your .env file against .env.example.\n`);
  }
  return parsed.data;
}

let cached: Env | undefined;
export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}
```

(`packages/shared/src/env.ts`, elided) — every environment variable BOND OS reads is declared once,
in one Zod schema, and validated at first access. Three properties worth calling out:

1. **`import 'server-only'` at the top of the file** (`env.ts:1`) makes this module uncompilable
   from a Client Component — a bundler error, not a runtime check, if any client-side code tries to
   import it. Secrets can never accidentally end up in a client bundle through this module.
2. **Fail-fast validation.** `loadEnv()` throws immediately, with every validation issue listed, if
   any required variable is missing or malformed — the process refuses to serve a single request
   with an invalid configuration rather than failing unpredictably deep inside a request handler
   later. `BETTER_AUTH_SECRET` specifically enforces a **minimum length of 16 characters** — a
   short or empty secret is rejected outright, not silently accepted.
3. **Lazy, cached parse.** `getEnv()` parses `process.env` once, on first call, and caches the
   result (`cached: Env | undefined`) — every subsequent call in the same process returns the same
   validated object without re-parsing.

Application code never reads `process.env.SOME_SECRET` directly outside this file — every access
goes through `getEnv()` (or the `env` Proxy export, which lazily delegates to the same function).
This means there is exactly one place in the codebase where "what environment variables does BOND
OS use, and what shape must they have" is answered authoritatively.

## What's committed, what isn't

```
# .gitignore
.env
.env.local
.env.*.local
!.env.example
```

(`.gitignore:21-24`) — every `.env*` file is excluded from version control **except**
`.env.example`, which is explicitly re-included (`!.env.example`) as the checked-in template. This
is the standard, correct pattern: real secret values never enter the repository's history;
`.env.example` documents which variables exist and what a safe placeholder/local-dev value looks
like, without containing any credential that's actually valid anywhere.

`.env.example` itself makes this explicit inline, e.g. for the auth secret:

```
# Random 32+ char secret used to sign sessions. Generate with:
#   openssl rand -base64 32
BETTER_AUTH_SECRET="replace-with-a-random-32-char-secret"
```

The placeholder value is obviously not a real secret (`"replace-with-a-random-32-char-secret"` is
27 characters of literal instruction text, not a random value) — anyone who deploys BOND OS without
replacing it would fail `getEnv()`'s own minimum-length-and-non-empty check only if they left it
literally empty; the checked-in placeholder string is long enough to *pass* validation, so an
operator who copies `.env.example` to `.env` without reading the comment could accidentally deploy
with a guessable, publicly-visible secret. This is worth naming as an operational risk: **schema
validation confirms a secret is present and long enough, not that it's actually secret.**

## Every secret/credential, by category

### Core application

| Variable | Required? | Validation | Where read |
|---|---|---|---|
| `DATABASE_URL` | Yes | Must be a valid URL | `packages/database` (Prisma client) |
| `BETTER_AUTH_SECRET` (or legacy `NEXTAUTH_SECRET`) | Yes | Min 16 chars, non-empty | `packages/auth/src/server.ts:26` — passed as Better Auth's `secret`, used to sign session tokens |
| `APP_URL` | No (defaults to `http://localhost:3000`) | Valid URL | Better Auth's `baseURL`/`trustedOrigins`; [`assertSameOrigin`](./threat-model.md#csrf-cross-site-request-forgery)'s allowed-origin check |

### Storage (Supabase)

`SUPABASE_URL`, `SUPABASE_KEY` — both optional in the schema (`.optional().or(z.literal(''))`).
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` also appear in `.env.example` — the
`NEXT_PUBLIC_` prefix means these are intentionally exposed to the browser bundle by Next.js
convention (Supabase's anon key is designed to be public; access control is enforced by Supabase's
own row-level security, not by keeping this key secret).

### Cache / rate limiting (Redis)

`REDIS_URL` — optional. Left unset, BOND OS falls back to the in-memory cache and in-memory rate
limiter (see [Threat Model → Rate limiting](./threat-model.md#rate-limiting) for what that
single-instance fallback actually means in practice). No secret is embedded in the connection
string beyond whatever credential the URL itself carries; `docker-compose.yml`'s local Redis
service has no password configured (`redis:7-alpine`, `redis-cli ping` healthcheck, no `--requirepass`) —
appropriate for local development, not a production posture to carry forward as-is.

### Email (SMTP)

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` — all optional.
`getEmailProvider()` (`packages/auth/src/email.ts:61-66`) picks `SmtpEmailProvider` iff
`getEnv().SMTP_HOST` is set, otherwise falls back to `ConsoleEmailProvider`, which logs the email
via `logger.child('email')` instead of sending it — password-reset flows work in local development
with zero external configuration and zero real credentials required. `SmtpEmailProvider` lazily
imports `nodemailer` and builds a transport from these four variables only when actually needed.

### AI providers

`OPENAI_API_KEY`, `GEMINI_API_KEY`, `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY` — all optional, each tied
to a specific provider selected via `EMBEDDING_PROVIDER`/`AI_PROVIDER`. `EMBEDDING_PROVIDER`
defaults to `'LOCAL'`, a zero-config deterministic fallback that needs no API key to boot — the same
"always have a working default" pattern this codebase applies to Redis/cache. `AI_PROVIDER` has no
default at all (left `undefined` if unset) — there is no zero-config default for generation, only
for embeddings.

### Webhook secrets — `WorkflowDefinition.webhookSecret`

Unlike every other secret in this document, a webhook's HMAC secret is not an environment
variable — it's a **per-workflow, application-generated value stored as a plain column**:

```prisma
/// Set only when `triggerType = WEBHOOK`. Plaintext at rest, consistent
/// with this codebase's existing posture on integration secrets (e.g.
/// `Account.accessToken`/`refreshToken` are plain columns too) — no
/// field-level encryption utility exists anywhere in this codebase to
/// build against yet.
webhookSecret  String?
```

(`packages/database/prisma/schema.prisma:1823-1828`, on `WorkflowDefinition`) — the schema comment
states plainly that this is stored **unencrypted at the database level**, and that this is a
deliberate, acknowledged posture rather than an oversight: no field-level encryption utility exists
anywhere in this codebase to build against. It explicitly cites the precedent this follows —
Better Auth's own `Account.accessToken`/`refreshToken` columns (OAuth credentials for connected
accounts) are equally plain, unencrypted `String` columns
(`packages/database/prisma/schema.prisma:271-281`). Confidentiality for both rests entirely on
database access control (who can reach Postgres directly) — there is no application-layer
encryption-at-rest for any secret-shaped column in this schema. A security-conscious deployment
should treat "who has direct database access" as equivalent to "who can read every webhook secret
and every connected OAuth token," and scope database credentials/network access accordingly.

The webhook secret itself is verified via HMAC-SHA256 (`createHmac('sha256', secret)`,
`apps/web/features/workflows/services/workflow-webhook.service.ts:26-28`), compared with
[`secureCompare`](./threat-model.md#mitigation-constant-time-secret-comparison) — the comparison is
constant-time even though the storage isn't encrypted. See
[Threat Model → Non-session authentication boundaries](./threat-model.md#non-session-authentication-boundaries)
for the full inbound-webhook authentication flow this secret gates.

### `CRON_SECRET` — the scheduler's bearer token

```ts
// Shared-secret header the tick endpoint (`POST /api/workflows/schedule/tick`)
// requires, compared via `crypto.timingSafeEqual` — fails closed (404) if
// unset. No default: an operator must deliberately set this to wire an
// external caller (Vercel Cron, GitHub Actions, OS Task Scheduler) to the
// tick URL. See docs/scheduling.md.
CRON_SECRET: z.string().optional().or(z.literal('')),
```

(`env.ts:100-105`) — the one credential in this schema with **no default and no fallback**. If
unset, `POST /api/workflows/schedule/tick` fails closed as a `404` for every request, meaning
BOND OS's entire time-based workflow execution surface (scheduled triggers, `WAIT`/`DELAY` step
resumption) simply does not run until an operator deliberately provisions this value and wires an
external scheduler to call the endpoint with it as a bearer token. There is no key-rotation
tooling, no expiry, and no multiple-valid-secrets support — a single shared string, compared with
`secureCompare`, is the entire mechanism.

### Budget/tuning values (not secrets, included for completeness)

`APPROVAL_EXPIRY_MINUTES`, `BOND_MAX_TOOL_CALLS`, `AGENT_MAX_DELEGATION_DEPTH`,
`WORKFLOW_MAX_SYNC_STEPS`, `WORKFLOW_MAX_SYNC_MS`, `MEMORY_RETENTION_DAYS` are all plain,
non-secret numeric configuration read through the same `getEnv()` mechanism, each with a validated
default. They're listed here only because they live in the same schema and are relevant to the
security-adjacent budgets described in [Threat Model](./threat-model.md) and
[Approval Security](./approvals.md) — none of them are credentials.

## Gap: `.env.example` does not document every variable `env.ts` defines

This is a real, verifiable gap, confirmed by comparing the two files directly rather than assumed.
`packages/shared/src/env.ts` defines, and BOND OS's Phase 6–8 features depend on:

- `APPROVAL_EXPIRY_MINUTES`
- `AGENT_MAX_DELEGATION_DEPTH`
- `WORKFLOW_MAX_SYNC_STEPS`
- `WORKFLOW_MAX_SYNC_MS`
- `CRON_SECRET`
- `BOND_MAX_TOOL_CALLS`
- `MEMORY_RETENTION_DAYS`

**None of these appear in `.env.example`**, which stops at the Phase 4 (AI Memory & Retrieval)
variable set and a trailing `NODE_ENV` comment. This isn't a security hole by itself — every one of
these has a safe, validated default in `env.ts` except `CRON_SECRET`, which fails closed (the
scheduler endpoint 404s) rather than open when absent — but it is a genuine onboarding/documentation
gap: an operator copying `.env.example` to `.env` today has no in-template guidance that
`CRON_SECRET` exists at all, let alone that it needs to be set to enable scheduled workflows. A
technical reader relying on `.env.example` as the complete list of configurable variables would be
missing seven of them, one of which is a genuine secret with no default. This gap should be closed
by updating `.env.example` alongside a future change, not papered over here.

## Secrets in deployment (Docker)

```yaml
# docker-compose.yml
web:
  build:
    context: .
    dockerfile: Dockerfile
  env_file:
    - .env
  environment:
    DATABASE_URL: postgresql://bondos:bondos@postgres:5432/bondos?schema=public
    REDIS_URL: redis://redis:6379
```

Secrets reach the `web` service at **container runtime**, via `env_file: .env` — not baked into the
image at build time. The `Dockerfile` itself sets no secret-shaped `ENV`/`ARG` values (only
`NODE_ENV=production`, `PORT=3000`, `HOSTNAME="0.0.0.0"` — none of which are credentials), so the
built image contains no embedded secret regardless of which `.env` an operator later pairs it with.
The local Postgres/Redis services in `docker-compose.yml` use hardcoded, clearly-non-production
credentials (`bondos`/`bondos` for Postgres, no password at all for Redis) — fine for local
development, and consistent with `.env.example`'s own `DATABASE_URL` default pointing at the same
values, but not something to carry into a production deployment without change. See
[Docker Deployment](../deployment/docker.md) for the full deployment walkthrough.

## Password handling

BOND OS application code never touches a raw password. `emailAndPassword` (Better Auth,
`packages/auth/src/server.ts:29-34`) handles hashing, verification, and storage entirely inside
Better Auth's own Prisma adapter — the password hash lives on the `credential`-provider `Account`
row, not on `User` (per the schema's own comment, `schema.prisma:268-270`). Minimum length is
enforced (`minPasswordLength: 8`, `maxPasswordLength: 128`); password-reset tokens expire after one
hour (`resetPasswordTokenExpiresIn: 60 * 60`), delivered via the SMTP/Console email provider
described above. See [Authentication](./authentication.md) for the full session and credential
flow.

## What's deliberately not built

- **No field-level encryption for secret-shaped database columns** (`webhookSecret`,
  `Account.accessToken`/`refreshToken`). Confidentiality rests on database access control alone —
  stated directly in the schema's own comment, not inferred here.
- **No secrets manager integration** (Vault, AWS Secrets Manager, Doppler, etc.) — every secret is
  a plain environment variable, sourced from a `.env` file or the deploying platform's own env-var
  mechanism.
- **No key rotation tooling** for `BETTER_AUTH_SECRET`, `CRON_SECRET`, or any `webhookSecret` —
  rotating any of these today is a manual operational step (change the value, redeploy), with no
  in-app support for a grace-period dual-secret window.
- **No secret-scanning pre-commit hook or CI check** was found in this repository during this
  review — `.gitignore`'s exclusion of `.env*` is the only mechanical safeguard against committing
  a real secret.

## Related documents

- [Threat Model](./threat-model.md) — how `CRON_SECRET` and webhook signatures fit into BOND OS's
  broader authentication boundaries.
- [Approval Security](./approvals.md) — why `APPROVAL_EXPIRY_MINUTES` is configuration, not a
  secret, and why no signed token needed a secret key in the first place.
- [Authentication](./authentication.md) — `BETTER_AUTH_SECRET`'s role in session signing, in full.
- [Environment Configuration](../deployment/environment.md) — the complete operator-facing
  variable reference this document's security lens complements.
