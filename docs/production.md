# Production

Production operations overview (Phase 10). For first-time deployment mechanics (Vercel, database, secrets) see [`deployment/production.md`](deployment/production.md) and the repo root `FINAL_DEPLOYMENT_GUIDE.md`; this page is the day-2 operations index.

## Required configuration

Required: `DATABASE_URL` (Postgres + pgvector), `BETTER_AUTH_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL`.

Phase 10 env (all optional, sensible defaults):

| Var | Default | Purpose |
| --- | --- | --- |
| `PLATFORM_ADMIN_EMAILS` | — | bootstrap platform admins (see [admin.md](admin.md)) |
| `RATE_LIMIT_DEFAULT_LIMIT` / `RATE_LIMIT_DEFAULT_WINDOW_SECONDS` | 120 / 60 | fallback rate limit ([rate-limits.md](rate-limits.md)) |
| `ERROR_RETENTION_DAYS` | 30 | error retention |
| `USAGE_RETENTION_DAYS` | 90 | usage-event retention |
| `SECURITY_EVENT_RETENTION_DAYS` | 90 | security-event retention |
| `SEARCH_LOG_RETENTION_DAYS` | 90 | search-log retention |
| `STORAGE_LIMIT_MB` | 1024 | per-org storage soft-limit shown in metering |
| `REDIS_URL` | — | shared cache; also enables the Redis rate-limiter swap |
| `CRON_SECRET` | — | authenticates the workflow schedule tick |

## Database

The Phase 10 migration `20260722000000_phase10_observability` is **purely additive** — 8 new tables (`feature_flags`, `error_groups`, `error_events`, `usage_events`, `security_events`, `rate_limit_policies`, `search_query_logs`, `system_config`) and one additive `users.isPlatformAdmin` column; no existing table or relation changes. Apply with `pnpm --filter @bond-os/database run migrate:deploy` (or your provider's SQL runner).

## Serverless connection pooling

Use the transaction pooler for `DATABASE_URL` on serverless (e.g. Supabase port 6543 + `?pgbouncer=true&connection_limit=1`). Interactive transactions still work (transaction-scoped affinity). The session pooler's small client cap is exhausted quickly by the SSE/polling endpoints.

## Operating the deployment

- Health/readiness probes → [health.md](health.md)
- Errors / security / metering → [monitoring.md](monitoring.md)
- Structured logs & correlation → [logging.md](logging.md)
- Admin Console → [admin.md](admin.md); Analytics → [analytics.md](analytics.md)
- Day-2 runbook (background work, retention, incidents) → [operations.md](operations.md)
- Backups & recovery → [backups.md](backups.md)

## Verification

Every release must pass `pnpm prisma validate`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. See the Phase 10 implementation report (`docs/releases/`) for the v1.1.0 verification record.
