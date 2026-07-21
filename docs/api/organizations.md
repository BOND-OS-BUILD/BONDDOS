# Organizations API

API reference for `/api/organization/**` — the multi-tenant boundary every other surface in this
reference is scoped by. Creating an organization also provisions its single `Workspace` row
atomically (see [Workspace](./system.md#get-apiworkspaceorganizationid--get-workspace)); membership
rows here are what `requireRole()` checks on every org-scoped route across the whole API. See
[Organization Isolation](../security/organization-isolation.md) for the tenancy model and
[Permissions](../security/permissions.md) for the `OWNER > ADMIN > MEMBER` role hierarchy this
entire file enforces.

**5 route files, 10 endpoints.**

## Conventions

Same envelope, pagination, and error-mapping conventions as
[Tools & Execution API](./tools.md#conventions) apply throughout. Specific to this surface:

- Every mutating route calls `assertSameOrigin(request)`.
- **Auth here is `requireRole(organizationId, ...)` directly against the `{id}` path param**, not
  `requireActiveOrganizationId()` — every route in this file operates on an organization named
  explicitly in the URL, which may or may not be the caller's active org (per the
  `bondos_active_org` cookie). `GET /api/organization` (no `{id}`) is the one exception — it uses
  `requireAuth()` only, since it lists every org the caller belongs to.
- **No rate limiting anywhere in this surface.**
- **No automated tests exist for this surface** — see [Tools & Execution API](./tools.md#conventions).
- Two logo/avatar-style upload routes in this codebase share identical constants
  (`image/png`/`image/jpeg`/`image/webp`, 5MB max): this file's `POST /api/organization/[id]/logo`
  and [Authentication API](./authentication.md)'s `POST /api/user/avatar`.

---

## `GET /api/organization` — List My Organizations

**Method / Path**: `GET /api/organization`
**File**: `apps/web/app/api/organization/route.ts`
**Auth**: `requireAuth()` only.

Every organization the caller belongs to, each annotated with the caller's own role in it — the
data behind the org switcher.

### Response — `200`

```ts
interface OrganizationForUser {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}
```

```json
{
  "success": true,
  "data": [
    { "id": "org_1a2b3c...", "name": "Acme Corp", "slug": "acme-corp", "logo": null, "role": "OWNER" }
  ]
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |

---

## `POST /api/organization` — Create an Organization

**Method / Path**: `POST /api/organization`
**File**: `apps/web/app/api/organization/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()`.

Creates the `Organization`, its single `Workspace`, and an `OWNER` `Membership` for the caller, all
inside one Prisma transaction (`createOrganizationWithWorkspace`,
`packages/database/src/queries/organizations.ts:17`) — "every organization gets a workspace" is
guaranteed atomically, not by a follow-up call.

### Body — `createOrganizationSchema`

```ts
{
  name: string; // 1-120 chars, trimmed
  slug: string; // 2-63 chars, lowercase letters/numbers/hyphens only, e.g. "acme-corp"
}
```

### Example request

```json
{ "name": "Acme Corp", "slug": "acme-corp" }
```

### Response — `201`

The raw `Organization` row (not the `OrganizationForUser` shape above — no `role` field, since
there's exactly one obvious answer: `OWNER`).

```json
{
  "success": true,
  "data": {
    "id": "org_1a2b3c...",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "logo": null,
    "description": null,
    "website": null,
    "industry": null,
    "size": null,
    "createdAt": "2026-07-20T09:00:00.000Z",
    "updatedAt": "2026-07-20T09:00:00.000Z"
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin` header. |
| 409 | `CONFLICT` | `slug` is already taken (caught from Prisma's `P2002` unique-constraint error on `Organization.slug`). |
| 422 | `VALIDATION_ERROR` | Empty/over-length `name`, or `slug` fails the lowercase-alphanumeric-hyphen pattern. |

### Notes

- `packages/shared/src/schemas/organization.ts` also exports a `slugify()` helper (display name →
  URL-safe slug candidate) for client-side UX (auto-filling the slug field) — it's not called
  anywhere in this route; the server trusts whatever `slug` the client submits, validated only by
  `slugSchema`'s pattern.

---

## `GET /api/organization/[id]` — Get One Organization

**Method / Path**: `GET /api/organization/{id}`
**File**: `apps/web/app/api/organization/[id]/route.ts`
**Auth**: `requireRole(id, ROLES.MEMBER)`.

### Path params

| Param | Meaning |
|---|---|
| `id` | `Organization.id` |

### Response — `200`

The full `Organization` row — same shape as the `POST` response above, including the Phase 1
business-profile fields (`description`, `website`, `industry`, `size`).

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Not a member of `id`. |
| 404 | `NOT_FOUND` | No `Organization` with this `id`. |

---

## `PATCH /api/organization/[id]` — Update Organization

**Method / Path**: `PATCH /api/organization/{id}`
**File**: `apps/web/app/api/organization/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(id, ROLES.ADMIN)`.

### Body — `updateOrganizationSchema`

```ts
{
  name?: string;             // 1-120 chars
  slug?: string;              // same pattern as create
  logo?: string | null;       // valid URL
  description?: string | null; // max 2000
  website?: string | null;     // valid URL
  industry?: string | null;    // max 120
  size?: string | null;        // max 60
}
```

**Only `name`, `slug`, and `logo` are actually persisted** — the route handler writes exactly those
three fields (`apps/web/app/api/organization/[id]/route.ts:31`); `description`, `website`,
`industry`, and `size` all pass validation but are silently dropped before the `prisma.organization.update`
call. Same class of schema/route mismatch as `PATCH /api/user` (see
[Authentication API](./authentication.md)) — not a documentation simplification, a real gap in the
current code.

### Example request

```json
{ "name": "Acme Corporation", "slug": "acme-corp" }
```

### Response — `200`

The updated `Organization` row.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+ in `id`. |
| 409 | `CONFLICT` | New `slug` collides with another organization's. |
| 422 | `VALIDATION_ERROR` | Malformed body. |

---

## `DELETE /api/organization/[id]` — Delete Organization

**Method / Path**: `DELETE /api/organization/{id}`
**File**: `apps/web/app/api/organization/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(id, ROLES.OWNER)`.

Hard-deletes the `Organization` row. No confirmation step, no soft-delete, no explicit cascade
listing in the route itself — whatever the Prisma schema's `onDelete` behavior is for every
relation back to `Organization` (e.g. `Workspace` is `onDelete: Cascade`) determines what else
disappears with it.

### Path params

| Param | Meaning |
|---|---|
| `id` | `Organization.id` |

### Response — `200`

```json
{ "success": true, "data": { "id": "org_1a2b3c..." } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `OWNER`. |

### Notes

- This is the **only** `ROLES.OWNER`-gated route in the entire codebase's API surface — every other
  role-gated route tops out at `ADMIN`. Deleting an organization is irreversible and destroys every
  other member's data too, which is why it's held to a stricter bar than granting/revoking
  ownership itself (see `PATCH .../members/[userId]` below, which is `ADMIN`-gated except when an
  `OWNER` role is specifically involved).
- No "last owner" guard exists here (unlike `DELETE .../members/[userId]`, below) — deleting the
  organization needs no such check since there's nothing left to protect afterward.

---

## `GET /api/organization/[id]/members` — List Members

**Method / Path**: `GET /api/organization/{id}/members`
**File**: `apps/web/app/api/organization/[id]/members/route.ts`
**Auth**: `requireRole(id, ROLES.MEMBER)`.

### Response — `200`

```ts
interface MemberDto {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joinedAt: string; // ISO
}
```

Plain array, oldest-membership-first — **not** a `PaginatedResult` (no pagination on this list at
all; every member of the org is returned in one response).

```json
{
  "success": true,
  "data": [
    {
      "membershipId": "mem_9f0a...",
      "userId": "user_88ee1a2b...",
      "name": "Priya Salgotra",
      "email": "priya@acme.com",
      "avatar": null,
      "role": "OWNER",
      "joinedAt": "2026-06-01T09:00:00.000Z"
    }
  ]
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Not a member of `id`. |

---

## `POST /api/organization/[id]/members` — Add a Member

**Method / Path**: `POST /api/organization/{id}/members`
**File**: `apps/web/app/api/organization/[id]/members/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(id, ROLES.ADMIN)`.

**Not an invitation system** — there is no pending-invite state, no invite email, no token. The
target user must already have a BOND OS account (found by exact email match); the call adds a
`Membership` row directly and immediately.

### Body — `addMemberSchema`

```ts
{
  email: string;              // valid email, lowercased
  role?: 'OWNER' | 'ADMIN' | 'MEMBER'; // default 'MEMBER'
}
```

### Example request

```json
{ "email": "sam@acme.com", "role": "MEMBER" }
```

### Response — `201`

Same `MemberDto` shape as the list endpoint above.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`; caller isn't `ADMIN`+; **or** `role: "OWNER"` was requested by a caller who isn't themselves an `OWNER` ("Only an owner can grant ownership."). |
| 404 | `NOT_FOUND` | No `User` account exists for `email` — "they need to sign up first." |
| 409 | `CONFLICT` | That user is already a member of `id`. |
| 422 | `VALIDATION_ERROR` | Malformed email or invalid `role`. |

---

## `PATCH /api/organization/[id]/members/[userId]` — Change a Member's Role

**Method / Path**: `PATCH /api/organization/{id}/members/{userId}`
**File**: `apps/web/app/api/organization/[id]/members/[userId]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(id, ROLES.ADMIN)`.

### Path params

| Param | Meaning |
|---|---|
| `id` | `Organization.id` |
| `userId` | The target member's `User.id` |

### Body — `updateMemberRoleSchema`

```ts
{ role: 'OWNER' | 'ADMIN' | 'MEMBER' }
```

### Response — `200`

Updated `MemberDto`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`; caller isn't `ADMIN`+; **or** the target is currently `OWNER`, or `role: "OWNER"` is being granted, and the caller themselves isn't `OWNER`. |
| 404 | `NOT_FOUND` | No membership for `userId` in `id`. |
| 422 | `VALIDATION_ERROR` | Demoting the organization's **last remaining `OWNER`** ("An organization must have at least one owner."). |

### Notes

- Only an `OWNER` can touch an existing `OWNER`'s membership or grant ownership to someone else —
  an `ADMIN` can freely promote/demote between `ADMIN` and `MEMBER`, but never touches `OWNER` in
  either direction.

---

## `DELETE /api/organization/[id]/members/[userId]` — Remove a Member

**Method / Path**: `DELETE /api/organization/{id}/members/{userId}`
**File**: `apps/web/app/api/organization/[id]/members/[userId]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(id, ROLES.ADMIN)`.

### Path params

Same as `PATCH` above.

### Response — `200`

```json
{ "success": true, "data": { "removed": true } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`; caller isn't `ADMIN`+; **or** the target is `OWNER` and the caller isn't. |
| 404 | `NOT_FOUND` | No membership for `userId` in `id`. |
| 422 | `VALIDATION_ERROR` | Removing the organization's last remaining `OWNER`. |

### Notes

- `assertNotLastOwner` (a local helper shared by `PATCH` and `DELETE`) is the only guard preventing
  an organization from ending up with zero owners — it counts `role: 'OWNER'` memberships and
  throws `ValidationError` if the change would bring that count to 0.

---

## `POST /api/organization/[id]/logo` — Upload Organization Logo

**Method / Path**: `POST /api/organization/{id}/logo`
**File**: `apps/web/app/api/organization/[id]/logo/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(id, ROLES.ADMIN)`.

Multipart upload, identical constants and flow to `POST /api/user/avatar` (see
[Authentication API](./authentication.md)) — uploads to the `logos` bucket and writes the public
URL straight to `Organization.logo` in the same call.

### Body — `multipart/form-data`

| Field | Type | Notes |
|---|---|---|
| `file` | File | required; `image/png`, `image/jpeg`, or `image/webp`; max 5MB |

### Response — `200`

```json
{ "success": true, "data": { "logo": "https://.../logos/org_1a2b3c-....png" } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+ in `id`. |
| 422 | `VALIDATION_ERROR` | No `file`, unsupported MIME type, or file exceeds 5MB. |

## Related docs

- [Authentication API](./authentication.md) — `requireAuth()`/session mechanics, and the sibling
  `POST /api/user/avatar` upload route this file's logo route mirrors.
- [Organization Isolation](../security/organization-isolation.md) — why `requireRole(organizationId, ...)`
  against a path-param `id` (not the active-org cookie) is this file's auth pattern, unlike almost
  every other surface in this reference.
- [Permissions](../security/permissions.md) — the full `OWNER`/`ADMIN`/`MEMBER` hierarchy this file
  is the primary read/write surface for.
- [System API](./system.md) — `GET /api/workspace/[organizationId]`, the one-workspace-per-org
  record this file's `POST /api/organization` provisions atomically.
