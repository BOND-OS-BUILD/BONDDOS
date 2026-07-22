# Admin Console

The Admin Console (Phase 10) is the platform-level administration portal, distinct from the per-organization dashboard. It lives at `/admin` and is available only to **platform administrators**.

## Platform administrators

Platform admin is a deployment-wide role, separate from the org-scoped `Role` (OWNER/ADMIN/MEMBER). A user is a platform admin if either:

1. their email is in the `PLATFORM_ADMIN_EMAILS` env allowlist (comma-separated) — the bootstrap path for the first administrator; or
2. their `User.isPlatformAdmin` DB flag is `true` — grantable in-app from **Admin → Users**.

Authorization is enforced by `requirePlatformAdmin()` (`packages/auth/src/admin.ts`): it throws `AuthError` (401) if unauthenticated or `ForbiddenError` (403) otherwise. The `/admin` layout gates access and redirects non-admins to `/dashboard`; every admin service re-checks with `requirePlatformAdmin()` (defence in depth).

## Views

| View | Route | Source |
| --- | --- | --- |
| Overview | `/admin` | platform stats + health + AI usage (`getAdminOverview`) |
| Organizations | `/admin/organizations` | `listPlatformOrganizations` |
| Users | `/admin/users` | `listPlatformUsers` + platform-admin toggle |
| Active Sessions | `/admin/sessions` | unexpired `Session` rows |
| Workflow Runs | `/admin/workflow-runs` | cross-org `WorkflowRun` |
| Tool Executions | `/admin/tool-executions` | cross-org `ToolExecution` |
| Audit Logs | `/admin/audit-logs` | cross-org `AuditEvent` |
| Security | `/admin/security` | `SecurityEvent` (see [monitoring.md](monitoring.md)) |
| Errors | `/admin/errors` | grouped errors (see [monitoring.md](monitoring.md)) |
| System Health | `/admin/health` | `getHealthReport` (see [health.md](health.md)) |
| Feature Flags | `/admin/feature-flags` | see [feature-flags.md](feature-flags.md) |
| Rate Limits | `/admin/rate-limits` | see [rate-limits.md](rate-limits.md) |
| System Config | `/admin/system-config` | effective platform configuration |

All views reuse existing operational tables — no data is duplicated. The read models live in `packages/database/src/repositories/platform.ts` and `users.ts`; the composition root is `apps/web/features/admin/services/admin.service.ts`.

## APIs (platform-admin)

- `GET/POST/DELETE /api/admin/feature-flags`
- `GET/POST/DELETE /api/admin/rate-limits`
- `GET/PATCH /api/admin/errors`
- `PATCH /api/admin/users` — grant/revoke platform admin
- `GET /api/admin/backup/config` — configuration export (see [backups.md](backups.md))

A platform admin cannot revoke their own platform-admin flag (guard in `setAdminUserPlatformAdmin`).
