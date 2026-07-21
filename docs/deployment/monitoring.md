# Monitoring

## Scope

What actually exists in this repository for observing a running BOND OS instance: structured logging
via pino, and nothing else. No APM, no metrics endpoint, no error-tracking service, no health-check
route suitable for an orchestrator. This document states what's there and names what isn't, matching
this documentation set's own convention of not inventing observability infrastructure the codebase
doesn't have.

## Structured logging via pino

`packages/shared/src/logger.ts` is the one logging primitive used across every package and
`apps/web`:

```ts
const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd() ? 'info' : 'debug'),
  base: { service: 'bond-os' },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isProd() ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});
```

- **Production** (`NODE_ENV === 'production'`): `transport` is `undefined`, so pino emits raw
  structured JSON directly to stdout — one JSON object per line, machine-parseable by any log
  collector that reads container stdout.
- **Development**: routed through `pino-pretty` for colorized, human-readable output in the terminal.
- Every log line carries `base: { service: 'bond-os' }` and an ISO timestamp, but nothing else is
  attached automatically — no request id, no organization id, no correlation id. The `correlationId`
  concept that does exist in this codebase (`apps/web/features/workflows/services/event-bus.service.ts`)
  is a workflow-domain field for chaining triggered `Event` rows to their originating trigger, not a
  logging/tracing concern — it never appears in a log line.
- `wrap()` exposes `.child(scope)` for namespacing — e.g. `apps/web/lib/api-handler.ts` creates
  `logger.child('api')`, so every error logged from the shared API error handler is tagged
  `scope: 'api'` in its JSON output.
- **`LOG_LEVEL` is the one environment variable read outside `env.ts`'s zod validation** — see
  [Environment Variables](./environment.md#log_level--an-unvalidated-escape-hatch). Default is `info`
  in production, `debug` otherwise.
- **No redaction.** `pino()` is constructed with no `redact` option — nothing automatically strips
  secrets, tokens, or PII from logged objects before they're written. A caller that logs a request
  body or an error object containing a sensitive field logs it in full. See
  [Security: Secrets](../security/secrets.md) for which columns are sensitive.
- **Output goes to stdout only.** No file transport, no network transport (no Logstash/Fluentd/Loki
  client), and no dependency in any `package.json` across the monorepo for a log-shipping agent —
  confirmed by there being no such package anywhere in the workspace. Whatever collects these logs
  (a container platform's own log driver, `docker logs`, a hosting platform's log tail) is entirely
  external to this codebase.

## Error visibility: server-side log only, generic response to the client

`apps/web/lib/api-handler.ts`'s `toErrorResponse` is the single place every Route Handler's thrown
error passes through:

```ts
} else {
  log.error(error instanceof Error ? error.message : String(error), {
    path: request.url,
    stack: error instanceof Error ? error.stack : undefined,
  });
  return NextResponse.json({ error: { message: 'Something went wrong.', code: 'INTERNAL_ERROR' } }, { status: 500 });
}
```

Every recognized `AppError` subclass (`ValidationError`, `AuthError`, `ForbiddenError`,
`NotFoundError`, `ConflictError`, `RateLimitError`) is also logged with its message/code/path before
mapping to its own HTTP status; anything unrecognized becomes a generic `500 INTERNAL_ERROR` with the
full message and stack trace written to the pino JSON log, never to the client response. This is the
entire error-visibility story — there is no secondary sink. An operator who wants alerting on error
rate, error grouping, or stack-trace search needs to point a log collector at stdout and build that on
top; nothing in this codebase pushes an event to an external error-tracking service.

## No APM, tracing, or metrics endpoint

Confirmed by inspecting every `package.json` in the monorepo (`apps/web` and all 10 packages): there
is no Sentry, Datadog, OpenTelemetry, New Relic, or `prom-client` dependency anywhere. Concretely:

- **No distributed tracing.** No span/trace instrumentation of any kind — a request's path through
  Route Handler → feature service → repository → database is only reconstructable after the fact from
  pino log lines that happen to share a `scope`, not from a trace id threaded through the call.
- **No metrics endpoint.** There is no `GET /metrics` (Prometheus-style or otherwise) anywhere in
  `apps/web/app/api/`. Throughput, latency percentiles, and error rate are not exposed by the
  application itself in any form.
- **No APM agent.** No process-level instrumentation (event loop lag, GC pauses, memory) is collected
  or exposed.

Everything an operator would normally get from one of those tools — request volume, latency, error
rate, resource usage — has to come from outside this codebase entirely: the hosting platform's own
infrastructure metrics, a reverse proxy's access logs, or a log collector's aggregation over the
pino JSON stream.

## No health-check endpoint

There is no `/api/health`, `/healthz`, `/api/status`, or any other route in this codebase designed as
a general liveness/readiness probe. The closest thing is `GET /api/ai/health`
(`apps/web/app/api/ai/health/route.ts`), and it is not usable as one:

```ts
export async function GET(request: NextRequest) {
  const organizationId = await requireActiveOrganizationId();
  const health = await getAIHealthService(organizationId);
  return NextResponse.json(health);
}
```

It requires an authenticated session (`requireActiveOrganizationId()` redirects/throws otherwise) and
an active organization, then calls through to `requireRole(organizationId, ROLES.MEMBER)` before
pinging the configured AI provider's own `health()` method. It answers "is the AI provider reachable
for this specific organization's session," not "is the application up" or "is the database reachable" —
an unauthenticated orchestrator probe (a Kubernetes liveness probe, an ALB health check, Docker
Compose's own `healthcheck:` mechanism) cannot call it at all, since every request without a valid
session is rejected before the handler body runs.

Consistent with this, `docker-compose.yml`'s `web` service has no `healthcheck:` block — only
`postgres` (`pg_isready`) and `redis` (`redis-cli ping`) do. Compose considers `web` "up" the moment
the container process starts, regardless of whether the Next.js server has finished booting or is
serving traffic successfully. See [Docker](./docker.md#no-healthcheck-for-web) for the container-level
consequence of this gap.

**Building a real one is a small, self-contained addition** (an unauthenticated route that does a
trivial `SELECT 1`-equivalent Prisma call and returns `200`), but nothing in this codebase does it
today — this is named as a gap, not implemented here, matching this documentation set's rule of
describing the actual implementation rather than the fix.

## What this means operationally

An operator running BOND OS in production today gets exactly one observability primitive — structured
JSON logs on stdout — and has to build everything else themselves:

- Point a log collector at the container's stdout to get searchable, retained logs; without one, logs
  exist only as long as the container's log buffer does.
- Add an orchestrator-level health check against a route this codebase doesn't yet provide, or accept
  "process started" as the only liveness signal `docker-compose.yml` currently offers for `web`.
- Wire an APM/error-tracking service in externally if error-rate alerting or trace-level debugging is
  needed — there is no in-code integration point prepared for one (no middleware hook, no
  `instrumentation.ts` calling out to a vendor SDK).

## Related documents

- [Environment Variables](./environment.md#log_level--an-unvalidated-escape-hatch) — `LOG_LEVEL` in
  full.
- [Docker](./docker.md#no-healthcheck-for-web) — the container-level consequence of no health-check
  route.
- [Production](./production.md) — the pre-deploy checklist this gap is called out in.
- [Troubleshooting](./troubleshooting.md) — how to read pino's JSON output when diagnosing an issue.
- [Security: Secrets](../security/secrets.md) — why unredacted logging matters for what gets logged.
