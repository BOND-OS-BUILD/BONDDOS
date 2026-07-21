# Company Data API

API reference for the five Phase 1 "Company Database" entities — `/api/customers/**`,
`/api/projects/**`, `/api/tasks/**`, `/api/documents/**`, `/api/meetings/**` — plus the Phase 2
"Knowledge Library" surface, `/api/library/**` (documents/folders/tags). These are the plain
relational CRUD endpoints every other surface in this reference (search, retrieval, the graph, Mr.
Bond's tools) ultimately reads from or links back to.

**18 route files, 38 endpoints.**

## Conventions

Same envelope, pagination, and error-mapping conventions as
[Tools & Execution API](./tools.md#conventions) apply throughout. Specific to this surface:

- Every route calls `requireActiveOrganizationId()`, then every service function re-checks
  `requireRole(organizationId, ROLES.MEMBER)` for reads/writes and `ROLES.ADMIN` for deletes — this
  pattern repeats identically across all five Phase 1 entities and the three library resources; it
  is not called out per-endpoint below unless a specific route deviates.
- Every mutating route calls `assertSameOrigin(request)`.
- **List query params** all extend the shared `paginationQuerySchema`
  (`page` default 1, `pageSize` default 20 max 100, optional `search`, `sortDir` default `desc`)
  with an entity-specific `sortBy` enum and filter fields — documented per entity below.
- **Cross-org reference validation**: every create/update that accepts another entity's id
  (a project's `ownerId`/`memberIds`, a task's `projectId`/`assigneeId`, a document's
  `projectId`/`meetingId`, a customer's `projectIds`, a meeting's `attendeeIds`) is checked against
  the caller's own organization before being persisted — a `ValidationError` or `NotFoundError` is
  thrown rather than silently wiring a record to a foreign org's user/project.
- **Optimistic locking (Phase 9)**: `Project`, `Document`, and `Meeting` updates accept an optional
  `expectedVersion` field. Omit it to keep last-write-wins behavior (every update still snapshots
  the pre-overwrite row into `EntityVersionSnapshot` and increments `version`, regardless of whether
  `expectedVersion` was passed); pass the version you last read to get a `409 CONFLICT` instead of
  silently clobbering a concurrent edit. `Customer` and `Task` updates have **no** version field —
  they remain plain last-write-wins.
- **Events**: creates/updates on `Customer`, `Project`, `Document` (create only), `Meeting`, and
  `Task` (update only — **not** create) publish a curated [Event](../workflows/event-bus.md) via a
  dynamically-imported `publishEvent()` (dynamic, not static, specifically to avoid a real circular
  import through the Tool Registry — see the comment atop each `*.service.ts` file). `Task` creation
  is the one asymmetric case: no event is published on create, only on update (`task.updated`, plus
  `task.completed` when `status` transitions to `DONE`).
- **No rate limiting anywhere in this surface.**
- **No automated tests exist for this surface** — see [Tools & Execution API](./tools.md#conventions).

---

# Customers

`Customer` — CRM-style contact/lead/account record. Files: `apps/web/app/api/customers/route.ts`,
`apps/web/app/api/customers/[id]/route.ts`. Service: `apps/web/features/customers/services/customer.service.ts`.

## `GET /api/customers` — List Customers

**Method / Path**: `GET /api/customers`
**File**: `apps/web/app/api/customers/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Query params — `customerQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `page`, `pageSize`, `search`, `sortDir` | — | — | shared pagination fields, see Conventions |
| `status` | enum | — | optional: `LEAD, ACTIVE, CHURNED, ARCHIVED` |
| `sortBy` | enum | `createdAt` | `name \| status \| createdAt` |

### Response — `200`

`data: PaginatedResult<CustomerListItem>`:

```ts
interface CustomerListItem {
  id: string; name: string; company: string | null; email: string | null; phone: string | null;
  website: string | null; status: 'LEAD' | 'ACTIVE' | 'CHURNED' | 'ARCHIVED'; notes: string | null;
  projectCount: number; emailCount: number; createdAt: string; updatedAt: string;
}
```

```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "cust_1a2b...", "name": "Jordan Lee", "company": "Acme Corp", "email": "jordan@acme.com", "phone": null, "website": null, "status": "ACTIVE", "notes": null, "projectCount": 2, "emailCount": 5, "createdAt": "2026-06-01T09:00:00.000Z", "updatedAt": "2026-07-10T12:00:00.000Z" }
    ],
    "page": 1, "pageSize": 20, "total": 1, "totalPages": 1
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 422 | `VALIDATION_ERROR` | Invalid `status`/`page`/`pageSize`. |

---

## `POST /api/customers` — Create Customer

**Method / Path**: `POST /api/customers`
**File**: `apps/web/app/api/customers/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `createCustomerSchema`

```ts
{
  name: string;             // 1-200 chars
  company?: string | null;  // max 200
  email?: string | null;    // valid email
  phone?: string | null;    // max 40
  website?: string | null;  // valid URL
  status?: 'LEAD' | 'ACTIVE' | 'CHURNED' | 'ARCHIVED'; // default 'LEAD'
  notes?: string | null;    // max 8000
  projectIds?: string[];    // default []
}
```

### Example request

```json
{ "name": "Jordan Lee", "company": "Acme Corp", "email": "jordan@acme.com", "status": "LEAD" }
```

### Response — `201`

`data: CustomerDetail` — `CustomerListItem` plus `organizationId`, `projects: {id,title}[]`, and
`emails: {id,subject,sender,recipient,sentAt,direction}[]`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 422 | `VALIDATION_ERROR` | Malformed body, or `projectIds` reference a project outside this organization. |

---

## `GET /api/customers/[id]` — Get One Customer

**Method / Path**: `GET /api/customers/{id}`
**File**: `apps/web/app/api/customers/[id]/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Response — `200`

`data: CustomerDetail` (see above).

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 404 | `NOT_FOUND` | No `Customer` with this `id` in this organization. |

---

## `PATCH /api/customers/[id]` — Update Customer

**Method / Path**: `PATCH /api/customers/{id}`
**File**: `apps/web/app/api/customers/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

**Body**: `updateCustomerSchema` — `createCustomerSchema.partial()`, every field optional.

### Response — `200`

`data: CustomerDetail`.

### Errors

Same as `POST /api/customers`, plus `404 NOT_FOUND` if `id` doesn't exist in this org.

---

## `DELETE /api/customers/[id]` — Delete Customer

**Method / Path**: `DELETE /api/customers/{id}`
**File**: `apps/web/app/api/customers/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

Also deletes every `Comment` attached to this customer (`deleteCommentsForEntity`) — comments have
no independent lifecycle once their target entity is gone.

### Response — `200`

```json
{ "success": true, "data": { "id": "cust_1a2b..." } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 404 | `NOT_FOUND` | No `Customer` with this `id`. |

---

# Projects

`Project` — the top-level unit of work; tasks, meetings, and documents all attach to one. Files:
`apps/web/app/api/projects/route.ts`, `apps/web/app/api/projects/[id]/route.ts`. Service:
`apps/web/features/projects/services/project.service.ts`.

## `GET /api/projects` — List Projects

**Method / Path**: `GET /api/projects`
**File**: `apps/web/app/api/projects/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Query params — `projectQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `status` | enum | — | `PLANNING, ACTIVE, ON_HOLD, COMPLETED, ARCHIVED` |
| `priority` | enum | — | `LOW, MEDIUM, HIGH, URGENT` |
| `ownerId` | string | — | filter to one owner |
| `sortBy` | enum | `createdAt` | `title \| status \| priority \| dueDate \| createdAt` |

### Response — `200`

`data: PaginatedResult<ProjectListItem>`:

```ts
interface ProjectListItem {
  id: string; title: string; description: string | null; status: string; priority: string;
  startDate: string | null; dueDate: string | null; owner: UserSummary | null;
  taskCount: number; documentCount: number; meetingCount: number; memberCount: number;
  createdAt: string; updatedAt: string;
}
```

```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "proj_11ee...", "title": "Q3 Onboarding Revamp", "description": null, "status": "ACTIVE", "priority": "MEDIUM", "startDate": null, "dueDate": "2026-09-30T00:00:00.000Z", "owner": { "id": "user_88ee...", "name": "Priya Salgotra", "email": "priya@acme.com", "avatar": null }, "taskCount": 4, "documentCount": 1, "meetingCount": 2, "memberCount": 3, "createdAt": "2026-06-01T09:00:00.000Z", "updatedAt": "2026-07-15T09:00:00.000Z" }
    ],
    "page": 1, "pageSize": 20, "total": 1, "totalPages": 1
  }
}
```

### Errors

Standard auth/role/validation errors as above.

---

## `POST /api/projects` — Create Project

**Method / Path**: `POST /api/projects`
**File**: `apps/web/app/api/projects/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `createProjectSchema`

```ts
{
  title: string;            // 1-200
  description?: string | null; // max 4000
  status?: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED'; // default 'PLANNING'
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; // default 'MEDIUM'
  startDate?: string | null; // ISO date
  dueDate?: string | null;   // ISO date
  ownerId?: string | null;
  memberIds?: string[];      // default []
}
```

### Example request

```json
{ "title": "Q3 Onboarding Revamp", "priority": "HIGH", "ownerId": "user_88ee...", "memberIds": ["user_88ee...", "user_cd12..."] }
```

### Response — `201`

`data: ProjectDetail` — `ProjectListItem` plus `organizationId`, `tasks[]` (id/title/status/priority/dueDate/assignee),
`documents[]` (id/title/type/fileName/createdAt), `meetings[]` (id/title/meetingDate/location), `members: UserSummary[]`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 422 | `VALIDATION_ERROR` | Malformed body, or `ownerId`/`memberIds` reference a user outside this organization. |

---

## `GET /api/projects/[id]` — Get One Project

**Method / Path**: `GET /api/projects/{id}`
**File**: `apps/web/app/api/projects/[id]/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Response — `200`

`data: ProjectDetail`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 404 | `NOT_FOUND` | No `Project` with this `id` in this organization. |

---

## `PATCH /api/projects/[id]` — Update Project

**Method / Path**: `PATCH /api/projects/{id}`
**File**: `apps/web/app/api/projects/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `updateProjectSchema`

`createProjectSchema.partial()` plus:

```ts
{ expectedVersion?: number } // optimistic-locking guard, see Conventions
```

### Response — `200`

`data: ProjectDetail`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 404 | `NOT_FOUND` | No `Project` with this `id`. |
| 409 | `CONFLICT` | `expectedVersion` was passed and doesn't match the row's current `version` — someone else edited it first. |
| 422 | `VALIDATION_ERROR` | Malformed body, or `ownerId`/`memberIds` outside this organization. |

### Notes

- Attributed edits: `editedById` (the caller's user id) is stamped on the `EntityVersionSnapshot`
  taken before every update, whether or not `expectedVersion` was supplied.

---

## `DELETE /api/projects/[id]` — Delete Project

**Method / Path**: `DELETE /api/projects/{id}`
**File**: `apps/web/app/api/projects/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

### Response — `200`

```json
{ "success": true, "data": { "id": "proj_11ee..." } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 404 | `NOT_FOUND` | No `Project` with this `id`. |

---

# Tasks

`Task` — always belongs to exactly one `Project`. Files: `apps/web/app/api/tasks/route.ts`,
`apps/web/app/api/tasks/[id]/route.ts`. Service: `apps/web/features/tasks/services/task.service.ts`.

**Asymmetry**: `tasks/[id]/route.ts` exports only `PATCH` and `DELETE` — **there is no
`GET /api/tasks/[id]`**, even though `task.service.ts` defines a `getTaskService` function (its own
comment says so explicitly: "There's no Task detail page, so this is intentionally not wrapped by a
route"). A single task's full detail is only reachable by fetching its parent project
(`GET /api/projects/[id]`, whose `tasks[]` array is list-shaped, not full `TaskDetail`) or by the
internal `getTaskById` repository call the create/update paths use to build their own response.

## `GET /api/tasks` — List Tasks

**Method / Path**: `GET /api/tasks`
**File**: `apps/web/app/api/tasks/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Query params — `taskQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `status` | enum | — | `TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED` |
| `priority` | enum | — | `LOW, MEDIUM, HIGH, URGENT` |
| `projectId` | string | — | filter to one project |
| `assigneeId` | string | — | filter to one assignee |
| `sortBy` | enum | `createdAt` | `title \| status \| priority \| dueDate \| createdAt` |

### Response — `200`

`data: PaginatedResult<TaskListItem>`:

```ts
interface TaskListItem {
  id: string; title: string; description: string | null; status: string; priority: string;
  dueDate: string | null; completedAt: string | null; project: { id: string; title: string };
  assignee: UserSummary | null; documentIds: string[]; createdAt: string; updatedAt: string;
}
```

### Errors

Standard auth/role/validation errors.

---

## `POST /api/tasks` — Create Task

**Method / Path**: `POST /api/tasks`
**File**: `apps/web/app/api/tasks/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

**No `task.created`/similar event is published on create** — see Conventions.

### Body — `createTaskSchema`

```ts
{
  title: string;              // 1-200
  description?: string | null; // max 4000
  status?: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'CANCELLED'; // default 'TODO'
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; // default 'MEDIUM'
  dueDate?: string | null;
  projectId: string;          // required
  assigneeId?: string | null;
  documentIds?: string[];     // default []
}
```

### Example request

```json
{ "title": "Follow up on onboarding docs", "projectId": "proj_11ee...", "assigneeId": "user_88ee..." }
```

### Response — `201`

`data: TaskDetail` — `TaskListItem` plus `documents: {id,title,type}[]`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 404 | `NOT_FOUND` | `projectId` doesn't resolve inside this organization. |
| 422 | `VALIDATION_ERROR` | Malformed body, or `assigneeId` outside this organization. |

---

## `PATCH /api/tasks/[id]` — Update Task

**Method / Path**: `PATCH /api/tasks/{id}`
**File**: `apps/web/app/api/tasks/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `updateTaskSchema`

`createTaskSchema.partial()` — no `expectedVersion` field (Task has no optimistic-locking column).

### Response — `200`

`data: TaskDetail`.

### Errors

Same as create, plus `404 NOT_FOUND` if `id` doesn't exist in this org.

### Notes

- Publishes `task.updated`, and additionally `task.completed` when the update transitions
  `status` to `DONE` — both curated [Events](../workflows/event-bus.md); this is the one Task
  route that publishes anything.

---

## `DELETE /api/tasks/[id]` — Delete Task

**Method / Path**: `DELETE /api/tasks/{id}`
**File**: `apps/web/app/api/tasks/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

### Response — `200`

```json
{ "success": true, "data": { "id": "task_44f1..." } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 404 | `NOT_FOUND` | No `Task` with this `id`. |

---

# Documents (Project/Meeting attachments)

`Document` — a file attached to a project/meeting/task, distinct from the Knowledge Library's
`KnowledgeDocument` (see the `/library/documents` section below — different table, different
purpose: this one is a plain attachment, the library one is parsed/chunked/embedded for retrieval).
Files: `apps/web/app/api/documents/route.ts`, `apps/web/app/api/documents/[id]/route.ts`. Service:
`apps/web/features/documents/services/document.service.ts`.

## `GET /api/documents` — List Documents

**Method / Path**: `GET /api/documents`
**File**: `apps/web/app/api/documents/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Query params — `documentQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `type` | enum | — | `PDF, DOCX, PPT, SPREADSHEET, NOTE, OTHER` |
| `projectId` | string | — | |
| `meetingId` | string | — | |
| `sortBy` | enum | `createdAt` | `title \| type \| size \| createdAt` |

### Response — `200`

`data: PaginatedResult<DocumentListItem>`:

```ts
interface DocumentListItem {
  id: string; title: string; description: string | null; type: string; fileName: string;
  mimeType: string; size: number; storagePath: string;
  project: { id: string; title: string } | null; meeting: { id: string; title: string } | null;
  uploadedBy: UserSummary | null; createdAt: string; updatedAt: string;
}
```

---

## `POST /api/documents` — Upload Document

**Method / Path**: `POST /api/documents`
**File**: `apps/web/app/api/documents/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()` → `requireActiveOrganizationId()` →
`requireRole(organizationId, ROLES.MEMBER)`.

Multipart upload — `multipart/form-data`, not JSON. `taskIds` has no native array encoding in
`FormData`, so the client appends the `taskIds` field once per id (`formData.getAll('taskIds')`)
rather than the request deferring task-linking to a follow-up `PATCH`.

### Body — `multipart/form-data`, metadata validated as `createDocumentMetadataSchema`

| Field | Type | Notes |
|---|---|---|
| `file` | File | required; max 20MB (no MIME allowlist enforced at this route, unlike the Library upload below) |
| `title` | string | required, 1-200 |
| `description` | string | optional, max 4000 |
| `type` | enum | optional, default `OTHER`: `PDF, DOCX, PPT, SPREADSHEET, NOTE, OTHER` |
| `projectId` | string | optional |
| `meetingId` | string | optional |
| `taskIds` | string (repeated) | optional, zero or more |

### Response — `201`

`data: DocumentDetail` — `DocumentListItem` plus `organizationId`, `tasks: {id,title,status}[]`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`. |
| 404 | `NOT_FOUND` | `projectId`/`meetingId` given but doesn't resolve in this org. |
| 422 | `VALIDATION_ERROR` | No `file`, file exceeds 20MB, or malformed metadata. |

### Notes

- Publishes `document.uploaded` (source `DOCUMENT`) — the one Document event this surface emits;
  update/delete publish nothing.
- Storage filename is `${crypto.randomUUID()}${extension}` — the original filename is preserved
  only in the `fileName` DB column, never used as the storage key.

---

## `GET /api/documents/[id]` — Get One Document

**Method / Path**: `GET /api/documents/{id}`
**File**: `apps/web/app/api/documents/[id]/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Response — `200`

`data: DocumentDetail`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 404 | `NOT_FOUND` | No `Document` with this `id`. |

---

## `PATCH /api/documents/[id]` — Update Document Metadata

**Method / Path**: `PATCH /api/documents/{id}`
**File**: `apps/web/app/api/documents/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

Metadata-only — **re-uploading a new file is not supported**; upload a new `Document` instead
(the schema's own comment: "re-uploading a new file replaces the document instead").

### Body — `updateDocumentSchema`

```ts
{
  title?: string; description?: string | null; type?: 'PDF' | 'DOCX' | 'PPT' | 'SPREADSHEET' | 'NOTE' | 'OTHER';
  projectId?: string | null; meetingId?: string | null; taskIds?: string[];
  expectedVersion?: number; // optimistic-locking guard, see Conventions
}
```

### Response — `200`

`data: DocumentDetail`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 404 | `NOT_FOUND` | No `Document` with this `id`, or `projectId`/`meetingId` doesn't resolve. |
| 409 | `CONFLICT` | Stale `expectedVersion`. |
| 422 | `VALIDATION_ERROR` | Malformed body. |

---

## `DELETE /api/documents/[id]` — Delete Document

**Method / Path**: `DELETE /api/documents/{id}`
**File**: `apps/web/app/api/documents/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

### Response — `200`

```json
{ "success": true, "data": { "id": "doc_7a2b..." } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 404 | `NOT_FOUND` | No `Document` with this `id`. |

### Notes

- Deletes attached `Comment`s (`deleteCommentsForEntity`), but the underlying file in storage is
  **not** explicitly deleted here (unlike the Library document delete below, which does call
  `deletePublicFile`) — the row disappears, the object in the bucket does not.

---

# Meetings

`Meeting` — always belongs to exactly one `Project`. Files: `apps/web/app/api/meetings/route.ts`,
`apps/web/app/api/meetings/[id]/route.ts`. Service:
`apps/web/features/meetings/services/meeting.service.ts`.

## `GET /api/meetings` — List Meetings

**Method / Path**: `GET /api/meetings`
**File**: `apps/web/app/api/meetings/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Query params — `meetingQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `projectId` | string | — | |
| `sortBy` | enum | `meetingDate` | `title \| meetingDate \| createdAt` — the one entity in this file whose default sort isn't `createdAt` |

### Response — `200`

`data: PaginatedResult<MeetingListItem>`:

```ts
interface MeetingListItem {
  id: string; title: string; agenda: string | null; location: string | null; meetingDate: string;
  duration: number | null; project: { id: string; title: string };
  attendeeCount: number; documentCount: number; createdAt: string; updatedAt: string;
}
```

---

## `POST /api/meetings` — Create Meeting

**Method / Path**: `POST /api/meetings`
**File**: `apps/web/app/api/meetings/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `createMeetingSchema`

```ts
{
  title: string;              // 1-200
  agenda?: string | null;     // max 4000
  notes?: string | null;      // max 8000
  location?: string | null;   // max 200
  meetingDate: string;        // required, ISO date
  duration?: number | null;   // minutes, 0-1440
  projectId: string;          // required
  attendeeIds?: string[];     // default []
}
```

### Example request

```json
{ "title": "Sprint Planning", "meetingDate": "2026-07-22T15:00:00.000Z", "projectId": "proj_11ee...", "attendeeIds": ["user_88ee..."] }
```

### Response — `201`

`data: MeetingDetail` — `MeetingListItem` plus `notes`, `organizationId`, `attendees: UserSummary[]`,
`documents: {id,title,type,fileName,createdAt}[]`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 422 | `VALIDATION_ERROR` | Malformed body, `projectId` outside this org (raised as `ValidationError`, not `NotFoundError`, unlike Task/Document's identical check), or `attendeeIds` outside this org. |

---

## `GET /api/meetings/[id]` — Get One Meeting

**Method / Path**: `GET /api/meetings/{id}`
**File**: `apps/web/app/api/meetings/[id]/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Response — `200`

`data: MeetingDetail`.

### Errors

Standard `404 NOT_FOUND`/auth failures.

---

## `PATCH /api/meetings/[id]` — Update Meeting

**Method / Path**: `PATCH /api/meetings/{id}`
**File**: `apps/web/app/api/meetings/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `updateMeetingSchema`

`createMeetingSchema.partial()` plus `{ expectedVersion?: number }`.

### Errors

Same pattern as `PATCH /api/projects/[id]` (409 on stale `expectedVersion`, 422 on bad refs).

---

## `DELETE /api/meetings/[id]` — Delete Meeting

**Method / Path**: `DELETE /api/meetings/{id}`
**File**: `apps/web/app/api/meetings/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

### Response — `200`

```json
{ "success": true, "data": { "id": "meet_3c4d..." } }
```

---

# Knowledge Library

Phase 2's "Knowledge Library" — `KnowledgeDocument` (a different table from `Document` above:
parsed, chunked, and embedded for retrieval — see [AI & Retrieval API](./ai.md)), `Folder`, and
`Tag`. Files: `apps/web/app/api/library/documents/route.ts`,
`apps/web/app/api/library/documents/[id]/route.ts`,
`apps/web/app/api/library/documents/[id]/chunks/route.ts`,
`apps/web/app/api/library/documents/[id]/download/route.ts`,
`apps/web/app/api/library/documents/[id]/metadata/route.ts`,
`apps/web/app/api/library/folders/route.ts`, `apps/web/app/api/library/folders/[id]/route.ts`,
`apps/web/app/api/library/tags/route.ts`. Service:
`apps/web/features/library/services/{library,folder,tag}.service.ts`.

## `GET /api/library/documents` — List Library Documents

**Method / Path**: `GET /api/library/documents`
**File**: `apps/web/app/api/library/documents/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Query params — `knowledgeDocumentQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `entityType` | enum | — | `DOCUMENT \| FILE` — the /library page's two tabs share one table |
| `folderId` | string | — | |
| `sortBy` | enum | `createdAt` | `title \| size \| createdAt` |

### Response — `200`

`data: PaginatedResult<KnowledgeDocumentListItem>`:

```ts
interface KnowledgeDocumentListItem {
  id: string; entityId: string; title: string; description: string | null;
  entityType: 'DOCUMENT' | 'FILE'; fileName: string; mimeType: string; size: number;
  parseStatus: 'PENDING' | 'PARSED' | 'FAILED' | 'UNSUPPORTED';
  folder: { id: string; name: string } | null; uploadedBy: UserSummary | null;
  chunkCount: number; createdAt: string; updatedAt: string;
}
```

---

## `POST /api/library/documents` — Upload Library Document

**Method / Path**: `POST /api/library/documents`
**File**: `apps/web/app/api/library/documents/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()` → `requireActiveOrganizationId()` →
`requireRole(organizationId, ROLES.MEMBER)`.

Uploads, virus-scans, parses, chunks, runs Smart Linking extraction, and generates embeddings — all
**synchronously, in one request** (no background worker exists in this codebase). `getQueue().enqueue(...)`
is also called to demonstrate the queue architecture even though nothing currently consumes it.
Parsing/Smart Linking/embedding failures are caught and logged individually — they never fail the
upload itself, so a document can come back `parseStatus: "FAILED"` with a `201` response.

### Body — `multipart/form-data`, metadata validated as `createKnowledgeDocumentMetadataSchema`

| Field | Type | Notes |
|---|---|---|
| `file` | File | required; max 25MB; MIME allowlist: PDF, DOCX, `text/plain`, `text/markdown`, `text/csv`, PNG/JPEG/WebP/GIF (matches the spec's supported-formats list for *storage* — parsing support is narrower, no OCR for images) |
| `title` | string | required, 1-200 |
| `description` | string | optional, max 4000 |
| `entityType` | enum | optional, default `DOCUMENT`: `DOCUMENT \| FILE` |
| `folderId` | string | optional |
| `tagIds` | string (repeated) | optional |

### Response — `201`

`data: KnowledgeDocumentDetail` — `KnowledgeDocumentListItem` plus `organizationId`, `storagePath`,
`parsedText: string | null`, `parsedPages: unknown`, `parsedMetadata: unknown`,
`tags: {id,name,color}[]`, `chunks: {id,chunkType,position,content,pageNumber}[]`.

```json
{
  "success": true,
  "data": {
    "id": "kdoc_5f2a...", "entityId": "ent_9c1a...", "title": "Q3 Sales Deck",
    "description": null, "entityType": "DOCUMENT", "fileName": "q3-sales.pdf",
    "mimeType": "application/pdf", "size": 482113, "storagePath": "knowledge/8f...pdf",
    "parseStatus": "PARSED", "parsedText": "Q3 Sales Overview...", "parsedPages": 12,
    "parsedMetadata": {}, "folder": null, "uploadedBy": { "id": "user_88ee...", "name": "Priya Salgotra", "email": "priya@acme.com", "avatar": null },
    "tags": [], "chunks": [ { "id": "chunk_1", "chunkType": "TEXT", "position": 0, "content": "Q3 Sales Overview...", "pageNumber": 1 } ],
    "chunkCount": 6, "createdAt": "2026-07-20T09:00:00.000Z", "updatedAt": "2026-07-20T09:00:05.000Z"
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`. |
| 404 | `NOT_FOUND` | `folderId` given but doesn't resolve in this org. |
| 422 | `VALIDATION_ERROR` | No `file`, file exceeds 25MB, unsupported MIME type, or the virus scan fails ("File failed the security scan: ..."). |

### Notes

- Publishes `document.uploaded` with `source: 'KNOWLEDGE_GRAPH'` — same event *type* as the plain
  Document upload above, different `source`, so consumers can distinguish the two.

---

## `GET /api/library/documents/[id]` — Get One Library Document

**Method / Path**: `GET /api/library/documents/{id}`
**File**: `apps/web/app/api/library/documents/[id]/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Response — `200`

`data: KnowledgeDocumentDetail` (full shape, including `parsedText`/`chunks`).

### Errors

Standard `404 NOT_FOUND`/auth failures.

---

## `PATCH /api/library/documents/[id]` — Update Library Document Metadata

**Method / Path**: `PATCH /api/library/documents/{id}`
**File**: `apps/web/app/api/library/documents/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `updateKnowledgeDocumentSchema`

```ts
{ title?: string; description?: string | null; folderId?: string | null; tagIds?: string[] }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 404 | `NOT_FOUND` | No document with this `id`, `folderId` doesn't resolve, or any `tagIds` entry doesn't belong to this organization. |
| 422 | `VALIDATION_ERROR` | Malformed body. |

---

## `DELETE /api/library/documents/[id]` — Delete Library Document

**Method / Path**: `DELETE /api/library/documents/{id}`
**File**: `apps/web/app/api/library/documents/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

Deletes the underlying `Entity` row (cascades to the `KnowledgeDocument`/`Chunk`/tag-link rows), and
also explicitly deletes the stored file from Supabase (`deletePublicFile`) — unlike the plain
Document delete above, this one does clean up storage.

### Response — `200`

```json
{ "success": true, "data": { "id": "kdoc_5f2a..." } }
```

---

## `GET /api/library/documents/[id]/chunks` — Get Chunks

**Method / Path**: `GET /api/library/documents/{id}/chunks`
**File**: `apps/web/app/api/library/documents/[id]/chunks/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)` (via `getKnowledgeDocumentService`).

Exposes the Chunking Engine's output for one document as its own sub-resource — internally just
calls the same `getKnowledgeDocumentService` as the main `GET .../[id]` route and slices out two
fields.

### Response — `200`

```json
{
  "success": true,
  "data": {
    "chunkCount": 6,
    "chunks": [
      { "id": "chunk_1", "chunkType": "TEXT", "position": 0, "content": "Q3 Sales Overview...", "pageNumber": 1 }
    ]
  }
}
```

### Errors

`404 NOT_FOUND` if the document doesn't exist in this org; standard auth errors.

---

## `GET /api/library/documents/[id]/download` — Get Download URL

**Method / Path**: `GET /api/library/documents/{id}/download`
**File**: `apps/web/app/api/library/documents/[id]/download/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Returns a **short-lived signed URL** rather than streaming the file through this route
(`getSignedDownloadUrl`, `apps/web/lib/supabase.ts`).

### Response — `200`

```json
{ "success": true, "data": { "url": "https://.../storage/v1/object/sign/knowledge/8f...pdf?token=..." } }
```

### Errors

`404 NOT_FOUND` if the document doesn't exist in this org; standard auth errors.

---

## `GET /api/library/documents/[id]/metadata` — Get Parse Metadata

**Method / Path**: `GET /api/library/documents/{id}/metadata`
**File**: `apps/web/app/api/library/documents/[id]/metadata/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Exposes the Metadata Extractor's output as its own sub-resource.

### Response — `200`

```json
{
  "success": true,
  "data": {
    "fileName": "q3-sales.pdf", "mimeType": "application/pdf", "size": 482113,
    "parseStatus": "PARSED", "extracted": { "pageCount": 12 }
  }
}
```

`extracted` is `KnowledgeDocument.parsedMetadata` verbatim (parser-specific shape, `unknown`).

### Errors

`404 NOT_FOUND` if the document doesn't exist in this org; standard auth errors.

---

## `GET /api/library/folders` — List Folders

**Method / Path**: `GET /api/library/folders`
**File**: `apps/web/app/api/library/folders/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

**Not paginated** — every folder in the org, flat, alphabetical. The UI builds the tree client-side
from each folder's `parentFolderId`.

### Response — `200`

```ts
interface FolderNode { id: string; name: string; parentFolderId: string | null; documentCount: number; createdAt: string; }
```

```json
{
  "success": true,
  "data": [
    { "id": "fold_1a2b...", "name": "Sales", "parentFolderId": null, "documentCount": 3, "createdAt": "2026-06-01T09:00:00.000Z" }
  ]
}
```

---

## `POST /api/library/folders` — Create Folder

**Method / Path**: `POST /api/library/folders`
**File**: `apps/web/app/api/library/folders/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `createFolderSchema`

```ts
{ name: string; parentFolderId?: string | null } // name: 1-120 chars
```

### Response — `201`

`data: FolderNode`.

### Errors

Standard auth/CSRF/role/validation errors — **no check that `parentFolderId` exists or belongs to
this org** at creation time (unlike the folder-scoping checks on Library document upload/update).

---

## `PATCH /api/library/folders/[id]` — Rename Folder

**Method / Path**: `PATCH /api/library/folders/{id}`
**File**: `apps/web/app/api/library/folders/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `updateFolderSchema`

```ts
{ name: string } // 1-120 chars, required — rename only, no parentFolderId move
```

### Response — `200`

```json
{ "success": true, "data": { "id": "fold_1a2b..." } }
```

Note the response is just the echoed `id`, not the updated `FolderNode`.

### Errors

`404 NOT_FOUND` if no folder with this `id` in this org; standard auth/CSRF/validation errors.

---

## `DELETE /api/library/folders/[id]` — Delete Folder

**Method / Path**: `DELETE /api/library/folders/{id}`
**File**: `apps/web/app/api/library/folders/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

Documents inside are **not** deleted — their `folderId` becomes `null` via the schema's
`onDelete: SetNull`.

### Response — `200`

```json
{ "success": true, "data": { "id": "fold_1a2b..." } }
```

### Errors

`404 NOT_FOUND` if no folder with this `id`; standard auth/CSRF errors.

---

## `GET /api/library/tags` — List Tags

**Method / Path**: `GET /api/library/tags`
**File**: `apps/web/app/api/library/tags/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

**Not paginated.** Alphabetical.

### Response — `200`

```ts
interface TagSummary { id: string; name: string; color: string | null; }
```

```json
{ "success": true, "data": [ { "id": "tag_1a2b...", "name": "sales", "color": "#22c55e" } ] }
```

---

## `POST /api/library/tags` — Create (or Reuse) Tag

**Method / Path**: `POST /api/library/tags`
**File**: `apps/web/app/api/library/tags/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

**Idempotent by `(organizationId, name)`** — `findOrCreateTag` reuses an existing tag with the same
name instead of erroring on the unique constraint, so calling this twice with the same `name` never
fails or duplicates.

### Body — `createTagSchema`

```ts
{ name: string; color?: string | null } // name: 1-60 chars; color: max 20
```

### Response — `201`

`data: TagSummary`.

### Errors

Standard auth/CSRF/role/validation errors.

### Notes

- **`deleteTagService` exists (`ADMIN`-gated) in `tag.service.ts` but there is no route that calls
  it** — no `DELETE /api/library/tags/[id]` file exists anywhere under `apps/web/app/api/library/tags/`.
  Tags can currently be created and listed, but not deleted through the API.

## Related docs

- [AI & Retrieval API](./ai.md) — chunks/embeddings generated during Library document upload feed
  directly into `POST /api/embeddings`'s pipeline and `GET /api/retrieval/document`.
- [Search API](./search.md) — the top-level `/api/search` endpoint fans out into `list*Service`
  calls for four of the five Phase 1 entities documented here.
- [Graph API](./graph.md) — every `Customer`/`Project`/`Task`/`Meeting` created here also exists as
  a graph node reachable via `GET /api/graph/node?type=...`.
- [Tools & Execution API](./tools.md) — `create_project`/`update_project`/`create_task`/
  `create_meeting`/`archive_project` are the 5 registered tools that call into this file's services
  under the write-approval gate, rather than writing directly.
