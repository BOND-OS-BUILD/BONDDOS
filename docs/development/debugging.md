# Debugging

How to actually find out why something is broken in BOND OS, given what's really in the repository: no
automated test suite, no CI, no APM/tracing package — verification and debugging here are manual, using
the dev server's own logs, Prisma Studio, and the consistent error envelope every API route returns. This
page is honest about that rather than describing tooling that isn't there; see
[`../testing/strategy.md`](../testing/strategy.md) for the fuller picture of what verification looks like
today.

## Start with `pnpm dev`'s own output

```bash
pnpm dev
```

runs `next dev` (via Turborepo) with `pino-pretty` enabled — `packages/shared/src/logger.ts` only turns
on the pretty transport outside production, so local dev logs are colorized, human-readable lines, not
raw JSON. Every subsystem logs through the same centralized `logger`
(`info`/`warn`/`error`/`debug`/`child(scope)`), namespaced by `logger.child('scope')` — e.g. `'auth'`,
`'email'`, `'api'`, `'storage'`. `apps/web/lib/api-handler.ts` uses `logger.child('api')` specifically.

### Logging

- Set `LOG_LEVEL` (e.g. `LOG_LEVEL=debug`) to see `debug`-level output; the default is `debug` outside
  production and `info` in production (`logger.ts`'s `level: process.env.LOG_LEVEL ?? (isProd() ? 'info' :
  'debug')`).
- **`console.log` is lint-disallowed** (`no-console: ['warn', { allow: ['warn', 'error'] }]`, and every
  package's zero-warning-budget lint script makes that a hard block — see
  [coding-standards.md](coding-standards.md#linting)). If you're temporarily adding a debug print while
  working on something, use `logger.child('your-scope').debug(...)` instead so it's consistent with
  everything else and won't fail lint if you forget to remove it before committing (though you should
  still remove it).
- There is no Sentry, Datadog, OpenTelemetry, or any other APM/tracing package in any `package.json` read
  for this documentation. `pino` structured logs are the only observability primitive that exists today.
  See [`../deployment/monitoring.md`](../deployment/monitoring.md) for what that implies for production.

## The error envelope

Every API route is wrapped in `apiHandler()` (`apps/web/lib/api-handler.ts`), which catches everything
thrown anywhere in the request — repository, service, zod parsing — and returns one consistent JSON
shape (`ApiResponse<T>` from `packages/shared/src/types/index.ts`):

```ts
// success
{ "success": true, "data": T }

// error
{ "success": false, "error": { "code": string, "message": string, "details"?: unknown } }
```

Knowing which of three branches produced a given error response tells you a lot about where to look:

1. **`error.name === 'ZodError'`** → always `422 VALIDATION_ERROR`, `message: "Invalid input."`, and
   `details: error.flatten()` — the real field-level validation errors are in `details`, not `message`.
   This means the request body/query string didn't match the zod schema; check the schema in
   `packages/shared/src/schemas/<feature>.ts` against what the client actually sent.
2. **An `AppError` subclass** (`ValidationError`/`AuthError`/`ForbiddenError`/`NotFoundError`/
   `ConflictError`/`RateLimitError`/`InternalError` — the complete list, see
   [coding-standards.md](coding-standards.md#layer-responsibilities-repos-return-signals-services-throw))
   → the error's own `statusCode`/`code`/`message`/`details` are returned as-is. **Only `statusCode >=
   500` errors are server-logged** (`log.error(error.message, { code, path })`) — a 404/`NOT_FOUND` or
   422/`VALIDATION_ERROR` deliberately produces no server-side log line, because those are expected,
   client-caused outcomes, not bugs. If you're chasing a `NotFoundError` and see nothing in the dev
   server's logs, that's expected — the message in the JSON response itself is the only signal.
3. **Anything else (an unexpected `Error`, a Prisma error, etc.)** → **always** logged via
   `log.error('Unhandled API error', { path, message, stack })`, with the full stack trace — and the
   client only ever receives a generic `500 INTERNAL_ERROR`, `"Something went wrong."`, with no `details`
   and no leaked internal message. **This is where you actually need to look at the dev server's terminal
   output** — the real exception and stack trace are there, never in the browser/network tab.

So: a 500 with a generic message means "go read the server logs right now"; a 4xx with a specific message
means "the message and `details` already tell you what's wrong, no log line to chase."

### On the client

The convention across every `'use client'` form/table component (see `task-form-dialog.tsx`,
`tasks-table.tsx`) is to `fetch()`, parse the JSON, and check `result.success`:

```ts
const response = await fetch('/api/tasks', { method: 'POST', body: JSON.stringify(values) });
const result = await response.json();
if (!result.success) {
  toast.error(result.error.message);
  return;
}
```

The raw `error.message` from the envelope is shown directly to the user via a `sonner` toast — for
`AppError`s this is safe (the message was written to be user-facing), and for the generic 500 case it's
just `"Something went wrong."` by design. If you're debugging a UI issue and a toast shows a specific
message, that tells you which branch above produced it.

## CSRF: a common gotcha when testing routes directly

Every mutating route (`POST`/`PATCH`/`DELETE`) calls `assertSameOrigin(request)`
(`apps/web/lib/csrf.ts`) before anything else, which checks the request's `Origin` header against
`APP_URL`. If you're testing a mutating endpoint with `curl`, Postman, or any tool that doesn't
automatically set an `Origin` header the way a browser `fetch()` does, you'll get:

- `403 FORBIDDEN`, `"Missing Origin header."` — no `Origin` header sent at all.
- `403 FORBIDDEN`, `"Cross-origin request rejected."` — an `Origin` header was sent but it didn't match
  `APP_URL`.

This is expected behavior, not a bug — add `-H "Origin: http://localhost:3000"` (or whatever your
`APP_URL` is) to reproduce a mutating request outside the browser.

## Auth: `requireAuth()`/`requireRole()` failures

`middleware.ts` only checks session-cookie *presence* at the edge (a UX redirect, no DB hit); the
authoritative check is `requireAuth()`/`requireRole(organizationId, role)`
(`packages/auth/src/session.ts`), called as the first line of nearly every service method. If a
request is unexpectedly getting a `401 AUTH_ERROR` or `403 FORBIDDEN`:

- `401` — no valid session at all, or (per `apps/web/lib/organization.ts`'s `requireActiveOrganizationId`)
  a valid session but zero organization memberships.
- `403` — a valid session and active organization, but the caller's role doesn't satisfy
  `roleSatisfies(role, required)` (`packages/shared/src/constants.ts`) for that operation — e.g. a
  `MEMBER` calling a delete endpoint that requires `ROLES.ADMIN`.

Check which role the operation actually requires in the relevant `*.service.ts` file — the role
requirement is a plain `requireRole(organizationId, ROLES.X)` call at the top of the function, not hidden
behind any indirection.

## "Invalid environment variables" on boot

`packages/shared/src/env.ts` validates `process.env` eagerly (zod) the first time `getEnv()`/`env` is
touched, and fails fast with a formatted, multi-line error listing every failing field — this is
deliberately loud rather than letting a missing var surface later as a confusing downstream error. Check
the listed variable(s) against `.env.example`; see [setup.md](setup.md#2-copy-environment-variables)
and [`../deployment/environment.md`](../deployment/environment.md) for the full variable reference.

## Prisma Studio

```bash
pnpm db:studio
```

Runs `prisma studio` against your configured `DATABASE_URL` (via `dotenv -e ../../.env`) — a browser-based
GUI for inspecting/editing rows directly. Useful for confirming what a repository call actually wrote
(or didn't write) without going through the app's UI, especially for org-scoping bugs (checking whether a
row's `organizationId` is what you expect) or optimistic-locking issues (checking a row's `version`
column and its `EntityVersionSnapshot` history — see
[`../security/organization-isolation.md`](../security/organization-isolation.md) and
[`../workflows/approvals.md`](../workflows/approvals.md) for the underlying models).

## Prisma Client type errors after a schema change

If TypeScript starts complaining about a model/field that you just added to `schema.prisma`, you almost
certainly just need to regenerate the client:

```bash
pnpm db:generate
```

(Any `db:migrate*` command runs this automatically.) The generated client at
`packages/database/src/generated` is gitignored — it doesn't exist until you generate it locally, and it
goes stale the moment `schema.prisma` changes without a regenerate.

## Debugging a workflow / event-driven code path

Because `publishEvent()` fans out synchronously and its dispatch phase is wrapped in its own
`try`/`catch` (so a workflow dispatch failure never breaks the original write — see
[`../workflows/event-bus.md`](../workflows/event-bus.md)), a bug in a workflow triggered by, say, a
task update will **not** surface as an error on the `PATCH /api/tasks/:id` request at all — the task
update itself will have succeeded. Look instead at:

- The dev server logs around the time of the write, for whatever `logger.child(...)` scope the workflow
  engine uses.
- The `WorkflowRun`/`WorkflowRunStep` rows themselves via Prisma Studio, or the Execution History UI
  (`/execution`, backed by `apps/web/features/execution/`) — a failed step's `output`/error detail is
  stored on the row, not just logged.
- `/workflows/runs` and `/workflows/runs/[id]` in the dashboard UI, which render every step's input/output
  JSON directly — see `apps/web/app/(dashboard)/workflows/runs/[id]/page.tsx`.

## What manual verification looks like today

There is no `test` script in any `package.json`, no test-framework dependency, and no `.github/workflows`
directory in this repository — confirmed by direct inspection, not an assumption. The verification bar
that's actually been applied per-commit throughout this project's real history is:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

plus a manual dev-server smoke test of the changed surface, and — for security-sensitive changes — a
manual adversarial review pass (an example of this exact process is recorded in this repo's own commit
`0a70630`, which found and fixed two real authorization-naming/documentation bugs by walking every new
table's org-isolation, checking SSE-channel authorization, and re-verifying mention/notification
behavior against code). Follow the same bar for your own changes until a real test suite exists — see
[`../testing/strategy.md`](../testing/strategy.md) for what a real one would need to cover, and
[git-workflow.md](git-workflow.md) for how this is reflected in commit messages.

## Further reading

- [`../deployment/troubleshooting.md`](../deployment/troubleshooting.md) — deployment-specific issues
  (including the Windows symlink note, also covered in [setup.md](setup.md)).
- [`../deployment/monitoring.md`](../deployment/monitoring.md) — the current observability posture.
- [`../security/audit.md`](../security/audit.md) — the immutable audit trail for the Tool Execution
  Framework's write lifecycle, useful when debugging an AI/agent-initiated write specifically.
- [`../workflows/event-bus.md`](../workflows/event-bus.md) — the Event Bus mechanics referenced above.
- [coding-standards.md](coding-standards.md) — the error hierarchy and layer responsibilities this page
  assumes.
