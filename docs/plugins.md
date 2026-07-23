# Plugins (Phase 11)

## Scope

The plugin system lets an organization extend BOND OS with **validated,
declarative** manifests. Plugins are never executed as code — a manifest
*declares* the scopes it needs, the routes it serves, the UI slots it
contributes, and the events it hooks; the platform validates and records those
declarations.

- `packages/shared/src/plugins.ts` — the manifest schema + security rules.
- `packages/database/src/repositories/plugins.ts` — registry + installations.
- `apps/web/features/plugins/services/plugin.service.ts` — lifecycle + runtime.
- `apps/web/app/api/plugins/*` — routes.
- Developer → Plugins — install / manage.

## Manifest

```json
{
  "id": "time-tracker",
  "name": "Time Tracker",
  "version": "1.0.0",
  "author": "Acme Inc.",
  "description": "Log time against projects and tasks.",
  "permissions": ["projects:read", "tasks:read"],
  "routes": [{ "path": "/plugins/time-tracker/report", "method": "GET" }],
  "components": [{ "slot": "project.panel", "name": "Timesheet", "url": "https://example.com/embed" }],
  "hooks": [{ "event": "task.completed", "url": "https://example.com/webhooks/bondos" }]
}
```

Component slots are a fixed set (`dashboard.widget`, `project.panel`,
`record.action`, `settings.section`, `nav.item`). Behaviour is delivered
out-of-process via hosted URLs (components) and webhooks (hooks) — never inline
code.

## Security invariants

`pluginManifestSchema` + `validatePluginManifestSafety` enforce four
invariants, matching the Phase 11 security requirement that plugins cannot
bypass permissions, access other orgs, modify core, or inject code:

1. **No permission bypass** — every requested permission must be a real,
   non-super API scope (`ALL_API_SCOPES`, never `*`). The installation records
   only these `grantedScopes`.
2. **No cross-org access** — a plugin's registry key is namespaced
   `<organizationId>.<manifestId>`, and installations + every plugin-issued API
   call are org-scoped by the same layer as first-party calls.
3. **No core modification** — declared routes must start with
   `/plugins/<id>/`, so a manifest can never claim a core route.
4. **No code injection** — there is no code field and nothing is executed.

## Lifecycle

| Operation | Role | Route |
| --- | --- | --- |
| Install | ADMIN | `POST /api/plugins` |
| List installed | MEMBER | `GET /api/plugins` |
| Detail | MEMBER | `GET /api/plugins/{id}` |
| Enable / Disable | ADMIN | `POST /api/plugins/{id}/enable` · `/disable` |
| Upgrade | ADMIN | `POST /api/plugins/{id}/upgrade` |
| Uninstall | ADMIN | `DELETE /api/plugins/{id}` |

Statuses are `INSTALLED` / `ENABLED` / `DISABLED`.

## Isolation runtime

`resolveEnabledPluginContributions(organizationId)` is the single point the UI
(slots) and event system (hooks) read from. It returns only **ENABLED**
installations' contributions, each carrying the exact scopes it was granted — a
disabled or uninstalled plugin contributes nothing, and no plugin is ever
visible outside its own organization.
