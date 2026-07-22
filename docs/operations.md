# Operations

Day-2 operational reference for BOND OS (Phase 10).

## Health & readiness

Wire your load balancer / orchestrator to the probes in [health.md](health.md): liveness → `/api/health/live`, readiness → `/api/health/ready`, dashboards/alerts → `/api/health`.

## Background work

There is no distributed worker. Execution models:

- **Synchronous** — embedding generation and connector syncs run in-request.
- **Cron tick** — scheduled workflows run via `POST /api/workflows/schedule/tick`, authenticated by the `CRON_SECRET` bearer token. Wire an external scheduler (Vercel Cron, GitHub Actions, cron) to hit it.
- The `getQueue()` abstraction is an in-memory stub — the swap point for a real queue/worker.

The Admin Console surfaces background state: **Workflow Runs**, **Tool Executions**, **Active Sessions**, and queue status in **System Health**.

## Retention cleanup

Observability tables (`error_events`/`error_groups`, `usage_events`, `security_events`, `search_query_logs`) grow over time. Retention windows are set by env (`*_RETENTION_DAYS`; `0` disables). Run cleanup on the same external-cron pattern as the workflow tick — delete rows older than the window, e.g.:

```sql
DELETE FROM security_events WHERE "createdAt" < now() - interval '90 days';
DELETE FROM error_events    WHERE "createdAt" < now() - interval '30 days';
DELETE FROM search_query_logs WHERE "createdAt" < now() - interval '90 days';
DELETE FROM usage_events    WHERE "occurredAt" < now() - interval '90 days';
```

## Rate limits & feature flags

Tune live from the Admin Console — see [rate-limits.md](rate-limits.md) and [feature-flags.md](feature-flags.md). Both take effect on the next request.

## Incidents

1. Check `/admin/health` for component status.
2. Check `/admin/errors` for the error spike (grouped, with request context + correlation IDs).
3. Correlate with `/admin/security` for auth/permission/rate-limit anomalies.
4. Use `x-request-id` / `x-correlation-id` from a failing response to find the exact log lines.

## Configuration

Effective platform configuration is visible at `/admin/system-config`. Export it via `GET /api/admin/backup/config` — see [backups.md](backups.md).
