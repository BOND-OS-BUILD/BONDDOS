# System API

API reference for `/api/sync/**`, `/api/connectors/**`, `/api/workspace/**`, and `/api/emails/**` —
the connector/integration layer (Phase 2's stubbed external-system connectors and their manual sync
jobs), the one-per-org `Workspace` record, and Phase 1's metadata-only `Email` log.

**7 route files, 10 endpoints** (`GET`/`POST` both live under `/api/connectors` and under
`/api/emails`, and `PATCH`/`DELETE` both live under `/api/emails/[id]`, so those 3 files
contribute 2 endpoints each).

## Conventions

Same envelope, pagination, and error-mapping conventions as
[Tools & Execution API](./tools.md#conventions) apply throughout. Specific to this surface:

- Every route calls `requireActiveOrganizationId()` (or, for `/api/workspace/[organizationId]`,
  `requireRole` directly against the path param — see that route). Service functions re-check
  `requireRole(organizationId, ROLES.MEMBER)` for reads/writes, `ROLES.ADMIN` for
  `DELETE /api/connectors/[id]` and `DELETE /api/emails/[id]`.
- Every mutating route calls `assertSameOrigin(request)`.
- **Every connector provider is a stub.** `createConnector(provider).sync()` always throws
  `ConnectorNotImplementedError` in this codebase today — a `POST /api/connectors/[id]/sync` call
  always completes with a `FAILED` `SyncJob` carrying that error message. This is documented,
  expected behavior for this phase, not a bug to work around.
- **No background worker exists anywhere in this codebase.** Sync jobs only ever run when a caller
  explicitly hits `POST /api/connectors/[id]/sync` — nothing polls or schedules a sync
  automatically. This is the same "no background worker" posture the
  [Workflows API](./workflows.md#conventions)'s scheduler-tick section documents for that surface.
- **No rate limiting anywhere in this surface.**
- **No automated tests exist for this surface** — see [Tools & Execution API](./tools.md#conventions).

---

# Connectors

`Connector` — one row per `(organizationId, provider)`, representing whether/how an org has
connected an external system. 7 providers exist in the static catalog
(`CONNECTOR_PROVIDERS`): `GOOGLE_DRIVE, GMAIL, NOTION, SLACK, GITHUB, GOOGLE_CALENDAR, ONEDRIVE`.
Files: `apps/web/app/api/connectors/route.ts`, `apps/web/app/api/connectors/[id]/route.ts`,
`apps/web/app/api/connectors/[id]/sync/route.ts`. Service:
`apps/web/features/connectors/services/connector.service.ts`.

## `GET /api/connectors` — List Connectors (Catalog + Status)

**Method / Path**: `GET /api/connectors`
**File**: `apps/web/app/api/connectors/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Merges the static provider catalog (`CONNECTOR_CATALOG`, `@bond-os/connectors`) with the org's
actual `Connector` rows, so the UI can render every provider — including ones the org has never
connected — in one list.

### Response — `200`

```ts
interface ConnectorCatalogItem {
  provider: 'GOOGLE_DRIVE' | 'GMAIL' | 'NOTION' | 'SLACK' | 'GITHUB' | 'GOOGLE_CALENDAR' | 'ONEDRIVE';
  displayName: string; description: string;
  connector: {
    id: string; provider: string; status: 'DISCONNECTED' | 'CONNECTED' | 'ERROR';
    connectedBy: UserSummary | null; lastSyncAt: string | null; createdAt: string; updatedAt: string;
  } | null; // null if this org has never connected this provider
}
```

```json
{
  "success": true,
  "data": [
    { "provider": "GOOGLE_DRIVE", "displayName": "Google Drive", "description": "Sync files and folders from Google Drive.", "connector": null },
    { "provider": "SLACK", "displayName": "Slack", "description": "Sync messages and channels from Slack.", "connector": { "id": "conn_1a2b...", "provider": "SLACK", "status": "CONNECTED", "connectedBy": { "id": "user_88ee...", "name": "Priya Salgotra", "email": "priya@acme.com", "avatar": null }, "lastSyncAt": "2026-07-19T09:00:00.000Z", "createdAt": "2026-07-01T09:00:00.000Z", "updatedAt": "2026-07-19T09:00:00.000Z" } }
  ]
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |

---

## `POST /api/connectors` — Connect a Provider

**Method / Path**: `POST /api/connectors`
**File**: `apps/web/app/api/connectors/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()` → `requireRole(organizationId, ROLES.MEMBER)`.

Upserted on the `(organizationId, provider)` unique constraint — connecting an already-connected
provider updates it (no-op on the writable fields) rather than erroring or duplicating. New rows
start `status: "DISCONNECTED"` regardless of provider — there is no real OAuth handshake in this
codebase; this call only creates the bookkeeping row.

### Body — `connectConnectorSchema`

```ts
{ provider: 'GOOGLE_DRIVE' | 'GMAIL' | 'NOTION' | 'SLACK' | 'GITHUB' | 'GOOGLE_CALENDAR' | 'ONEDRIVE' }
```

### Response — `201`

`data: ConnectorSummary` (the `connector` shape from the list endpoint above, non-null).

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`. |
| 422 | `VALIDATION_ERROR` | Invalid `provider`. |

---

## `DELETE /api/connectors/[id]` — Disconnect

**Method / Path**: `DELETE /api/connectors/{id}`
**File**: `apps/web/app/api/connectors/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

### Response — `200`

```json
{ "success": true, "data": { "id": "conn_1a2b..." } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 404 | `NOT_FOUND` | No `Connector` with this `id` in this organization. |

---

## `POST /api/connectors/[id]/sync` — Trigger Manual Sync

**Method / Path**: `POST /api/connectors/{id}/sync`
**File**: `apps/web/app/api/connectors/[id]/sync/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

Creates a `SyncJob` row (`status: RUNNING`), then synchronously calls the provider's `.sync()`. As
noted in Conventions, every provider is currently a stub — `.sync()` always throws
`ConnectorNotImplementedError`, so the job always completes `FAILED` and the connector's `status`
moves to `ERROR`. This is real, current behavior, not a placeholder to special-case in
documentation — a `200` response with a `FAILED` job body is the expected result today.

### Path params

| Param | Meaning |
|---|---|
| `id` | `Connector.id` |

### Response — `200`

`data: SyncJob` (raw Prisma row — see `GET /api/sync/jobs` below for the equivalent `SyncJobSummary`
DTO shape returned by the list endpoint):

```json
{
  "success": true,
  "data": {
    "id": "sj_9c1a...", "organizationId": "org_1a2b...", "connectorId": "conn_1a2b...",
    "status": "FAILED", "trigger": "MANUAL", "startedAt": "2026-07-20T14:00:00.000Z",
    "completedAt": "2026-07-20T14:00:00.400Z", "itemsProcessed": 0, "itemsFailed": 0,
    "errorMessage": "Connector \"SLACK\" is not yet implemented.", "retryCount": 0
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or not a member. |
| 404 | `NOT_FOUND` | No `Connector` with this `id`. |

### Notes

- This route never itself returns a non-2xx for a sync failure — the failure is recorded *inside*
  the successfully-created `SyncJob`/`Connector` rows, which the `200` response surfaces. Treat a
  `200` here as "the sync attempt was recorded," not "the sync succeeded" — check `data.status`.

---

# Sync Jobs

`SyncJob` — one row per sync attempt, across every connector in the org. File:
`apps/web/app/api/sync/jobs/route.ts`. Service:
`apps/web/features/sync/services/sync.service.ts`.

## `GET /api/sync/jobs` — List Sync Jobs

**Method / Path**: `GET /api/sync/jobs`
**File**: `apps/web/app/api/sync/jobs/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Query params — `syncJobQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `page`, `pageSize` | — | 1 / 20 | shared pagination |
| `connectorId` | string | — | optional, filter to one connector |

### Response — `200`

`data: PaginatedResult<SyncJobSummary>`:

```ts
interface SyncJobSummary {
  id: string; connectorId: string; connectorProvider: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'RETRYING';
  trigger: 'MANUAL' | 'SCHEDULED' | 'WEBHOOK'; startedAt: string; completedAt: string | null;
  itemsProcessed: number; itemsFailed: number; errorMessage: string | null; retryCount: number;
}
```

### Errors

Standard auth/role/validation errors.

### Notes

- Every `SyncJob` in this codebase today has `trigger: "MANUAL"` — only
  `POST /api/connectors/[id]/sync` creates one; there is no scheduled or webhook-driven connector
  sync path, despite `SyncTrigger` declaring `SCHEDULED`/`WEBHOOK` as valid enum values.

---

# Workspace

`Workspace` — exactly one per organization, auto-provisioned atomically inside
`POST /api/organization` (see [Organizations API](./organizations.md)). File:
`apps/web/app/api/workspace/[organizationId]/route.ts`.

## `GET /api/workspace/[organizationId]` — Get Workspace

**Method / Path**: `GET /api/workspace/{organizationId}`
**File**: `apps/web/app/api/workspace/[organizationId]/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)` — called directly in the route (no separate
service layer for this one; the route reads `prisma.workspace` itself).

### Path params

| Param | Meaning |
|---|---|
| `organizationId` | `Organization.id` — **not** necessarily the caller's active org (same pattern as [Organizations API](./organizations.md)'s `/api/organization/[id]` family) |

### Response — `200`

`Workspace` has exactly four columns — no configurable settings live on it today:

```json
{
  "success": true,
  "data": { "id": "ws_1a2b...", "organizationId": "org_1a2b...", "createdAt": "2026-06-01T09:00:00.000Z", "updatedAt": "2026-06-01T09:00:00.000Z" }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Not a member of `organizationId`. |
| 404 | `NOT_FOUND` | No `Workspace` for this `organizationId` — should be unreachable in practice, since one is always created alongside its `Organization`. |

### Notes

- Read-only — no `PATCH`/`DELETE` route exists for `Workspace` anywhere in this codebase; there is
  currently nothing on the row to update besides its identity/timestamps.

---

# Emails

`Email` — Phase 1's metadata-only email log (subject/sender/recipient/timestamp/direction; no body
is stored). Always attached to a `Customer`, optionally to a `Project`. Files:
`apps/web/app/api/emails/route.ts`, `apps/web/app/api/emails/[id]/route.ts`. Service:
`apps/web/features/emails/services/email.service.ts`.

## `GET /api/emails` — List Emails

**Method / Path**: `GET /api/emails`
**File**: `apps/web/app/api/emails/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Query params — `emailQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `direction` | enum | — | `INCOMING \| OUTGOING` |
| `customerId` | string | — | |
| `projectId` | string | — | |
| `sortBy` | enum | `sentAt` | `subject \| sentAt \| createdAt` |

### Response — `200`

`data: PaginatedResult<EmailListItem>`:

```ts
interface EmailListItem {
  id: string; organizationId: string; subject: string; sender: string; recipient: string;
  sentAt: string; direction: 'INCOMING' | 'OUTGOING'; createdAt: string;
  customer: { id: string; name: string }; project: { id: string; title: string } | null;
}
```

---

## `POST /api/emails` — Create Email (Log Entry)

**Method / Path**: `POST /api/emails`
**File**: `apps/web/app/api/emails/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

Logs a metadata-only email record — there is no send/receive integration behind this; it's a manual
or connector-fed log entry, not a live mailbox.

### Body — `createEmailSchema`

```ts
{
  subject: string;     // 1-300
  sender: string;       // 1-320
  recipient: string;    // 1-320
  sentAt: string;        // ISO date, required
  direction: 'INCOMING' | 'OUTGOING';
  customerId: string;    // required
  projectId?: string | null;
}
```

### Example request

```json
{ "subject": "Re: Contract renewal", "sender": "jordan@acme.com", "recipient": "sales@bondos.com", "sentAt": "2026-07-19T10:00:00.000Z", "direction": "INCOMING", "customerId": "cust_1a2b..." }
```

### Response — `201`

`data: EmailListItem`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 404 | `NOT_FOUND` | `customerId`/`projectId` doesn't resolve in this organization. |
| 422 | `VALIDATION_ERROR` | Malformed body. |

---

## `PATCH /api/emails/[id]` — Update Email

**Method / Path**: `PATCH /api/emails/{id}`
**File**: `apps/web/app/api/emails/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

**Body**: `updateEmailSchema` — `createEmailSchema.partial()`.

### Response — `200`

`data: EmailListItem`.

### Errors

Same as create, plus `404 NOT_FOUND` if `id` doesn't exist in this org.

---

## `DELETE /api/emails/[id]` — Delete Email

**Method / Path**: `DELETE /api/emails/{id}`
**File**: `apps/web/app/api/emails/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

### Response — `200`

```json
{ "success": true, "data": { "id": "email_4d5e..." } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 404 | `NOT_FOUND` | No `Email` with this `id`. |

## Related docs

- [Organizations API](./organizations.md) — `POST /api/organization`'s atomic `Workspace`
  provisioning, and the `requireRole(organizationId, ...)`-against-path-param auth pattern
  `GET /api/workspace/[organizationId]` shares with it.
- [Company Data API](./company-data.md) — `Customer`/`Project`, the two entities every `Email` row
  attaches to.
- [AI & Retrieval API](./ai.md) — `Email.subject` is the one embeddable field for the `EMAIL`
  source type in `POST /api/embeddings`.
- [Connectors & Sync API](./connectors-sync.md) — a short pointer back to the Connectors/Sync
  Jobs sections above; there is no separate content to read there.
