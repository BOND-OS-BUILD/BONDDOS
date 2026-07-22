# Monitoring — Errors, Security & Metering

Phase 10 adds three observability stores, all populated automatically.

## Error reporting

Errors are grouped by a fingerprint (source + route + status + normalized message). Each group (`ErrorGroup`) rolls up `count` / `firstSeenAt` / `lastSeenAt` / `resolved`; each occurrence (`ErrorEvent`) keeps the full request / user / org / stack / route / browser context.

- **Server errors** — the API error boundary (`apps/web/lib/api-handler.ts`) captures every 500 / unhandled error via `captureError`.
- **Client errors** — the React error boundaries POST to `POST /api/errors`, joining the same store.
- **Console** — `GET /api/admin/errors` (list + stats), `PATCH /api/admin/errors` (resolve/reopen), UI at `/admin/errors`.
- Capture is failure-tolerant: a reporting failure never affects the original response.

## Security events

`SecurityEvent` backs the Security Dashboard (`/admin/security`, org-level via `getOrgSecurityDashboard`). Populated centrally, no hot-path writes on success:

| Event | Where it's recorded |
| --- | --- |
| `LOGIN_SUCCEEDED` / `LOGIN_FAILED` | auth route wrapper (`/api/auth/*/sign-in`) |
| `PERMISSION_DENIED` | API error boundary on 403 |
| `RATE_LIMIT_EXCEEDED` | rate-limit service on breach |

Other types (`APPROVAL_FAILED`, `TOOL_BLOCKED`, `CROSS_ORG_ATTEMPT`, `AUTH_REQUIRED`) are supported by the model and can be recorded via `recordSecurityEvent` as their hooks are enabled.

## Usage metering

Billing-ready, **no payment provider**. `metering.service` combines:

- **Derived** (from existing tables, no double-writes): AI tokens, embeddings, tool executions, workflow executions, notifications.
- **Explicit** `UsageEvent` rows (`recordUsage`): API calls and storage bytes — recordable hooks that read 0 until enabled, deliberately kept off the per-request hot path.

`GET /api/usage` returns the org summary (org ADMIN+). Quantities are stored as `BigInt`; summaries down-convert to `Number`.

## Retention

Retention windows are configured via env (`ERROR_RETENTION_DAYS`, `USAGE_RETENTION_DAYS`, `SECURITY_EVENT_RETENTION_DAYS`, `SEARCH_LOG_RETENTION_DAYS`); `0` disables cleanup for a table. See [operations.md](operations.md) for the cleanup routine.
