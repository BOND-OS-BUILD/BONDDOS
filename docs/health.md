# Health Monitoring

Phase 10 adds unauthenticated health probes plus the platform-admin System Health view.

## Endpoints

| Endpoint | Purpose | Status codes |
| --- | --- | --- |
| `GET /api/health` | Full component health | `200` healthy/degraded, `503` when `down` |
| `GET /api/health/live` | Liveness (process up) | always `200` |
| `GET /api/health/ready` | Readiness (DB reachable) | `200` ready, `503` not ready |

All three are unauthenticated (load balancers / uptime monitors). `/api/health` intentionally omits internal error messages; full detail is available only in the admin System Health view (`/admin/health`).

## Components

`getHealthReport()` (`apps/web/features/health/services/health.service.ts`) checks:

- **database** — a trivial `SELECT 1` (this is also the readiness signal).
- **redis** — `not_configured` when `REDIS_URL` is unset; otherwise a set/get round-trip.
- **storage** — Supabase bucket probe (`not_configured` when Supabase env is unset — uploads simply disabled).
- **ai** — deployment-level provider ping (`not_configured` when AI is per-organization only).
- **queue** — `degraded` by design: the queue is an in-memory stub; jobs run synchronously or via the workflow cron tick (no distributed worker).

## Overall status

`ok` → all components healthy · `degraded` → a non-critical component is down/degraded · `down` → the **database** is unreachable (the only fatal dependency). `not_configured` never degrades the overall status.

## Example

```json
{
  "status": "degraded",
  "version": "1.1.0",
  "components": {
    "database": { "status": "ok", "latencyMs": 12 },
    "redis": { "status": "not_configured" },
    "storage": { "status": "ok", "latencyMs": 88 },
    "ai": { "status": "not_configured" },
    "queue": { "status": "degraded" }
  }
}
```
