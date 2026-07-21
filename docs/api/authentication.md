# Authentication API

API reference for `/api/auth/**` (Better Auth's own catch-all handler) and the two profile routes
built on top of it, `/api/user` and `/api/user/avatar`. This document is about the HTTP surface
only — for the session/cookie mechanism itself (the Better Auth server instance, the
database-backed `Session` model, Edge middleware vs. the authoritative server-side check, password
reset delivery), see [Authentication](../security/authentication.md), which this surface is a thin
HTTP skin over.

**3 route files**: 1 catch-all (Better Auth's own router, mounting ~14 sub-endpoints it defines
itself) + `/api/user` + `/api/user/avatar`.

## Conventions

Same envelope and error-mapping conventions as [Tools & Execution API](./tools.md#conventions)
apply to `/api/user` and `/api/user/avatar`. Specific to this surface:

- **`/api/auth/**` does not use `apiHandler`/`apiSuccess` at all.** The entire route file is
  `export const { GET, POST } = toNextJsHandler(auth)` — every response on this path is shaped by
  Better Auth itself, not BOND OS's `{ success, data }` / `{ success: false, error }` envelope. Do
  not expect the standard envelope from any `/api/auth/*` path.
- **No `assertSameOrigin` on `/api/auth/**`.** Better Auth protects itself with its own
  `trustedOrigins: [env.APP_URL]` config (`packages/auth/src/server.ts:28`) — a second,
  BOND-OS-level CSRF check would be redundant. `/api/user` and `/api/user/avatar` are ordinary
  BOND OS routes, so both call `assertSameOrigin(request)` on their mutating methods exactly like
  every other surface in this reference.
- **Neither route in this file uses `requireActiveOrganizationId()`.** Identity (who is signed in)
  is orthogonal to organization membership here — `/api/user*` reads/writes the `User` row
  directly via `requireAuth()`, never scoped by organization.
- **No automated tests exist for this surface** — see [Tools & Execution API](./tools.md#conventions).

---

## `/api/auth/**` — Better Auth catch-all

**File**: `apps/web/app/api/auth/[...all]/route.ts` — the entire file body is:

```ts
import { auth } from '@bond-os/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth);
```

Every method/path under `/api/auth/*` is registered by the `better-auth` package itself (version
`1.6.23`, per `node_modules`), driven entirely by the `betterAuth({...})` config in
`packages/auth/src/server.ts:22-58`. BOND OS enables only the `emailAndPassword` provider — no
`plugins` array and no social providers are configured — so the live endpoint set is exactly
Better Auth's core surface with `emailAndPassword: { enabled: true, requireEmailVerification: false }`.
Reading the installed package's own route table
(`better-auth/dist/api/routes/*.mjs`) confirms these paths exist under `/api/auth/`:

| Path | Method(s) | Wired to app UI via `authClient`? |
|---|---|---|
| `/sign-up/email` | POST | Yes — `signup` page, `authClient.signUp.email` |
| `/sign-in/email` | POST | Yes — `login` page, `authClient.signIn.email` |
| `/sign-out` | POST | Yes — `authClient.signOut` |
| `/get-session` | GET | Yes — `authClient.useSession` (also `packages/auth/src/session.ts`'s server-side `auth.api.getSession`) |
| `/request-password-reset` | POST | Yes — `forgot-password` page, `authClient.requestPasswordReset` |
| `/reset-password` | POST | Yes — `authClient.resetPassword` |
| `/change-password` | POST | Yes — `settings/profile` page, `authClient.changePassword` |
| `/update-user` | POST | No dedicated UI call found — `/api/user` (below) is what the profile page actually calls for name/avatar edits |
| `/list-sessions`, `/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions` | GET/POST | No UI call found |
| `/change-email`, `/delete-user`, `/link-social`, `/list-accounts`, `/verify-email`, `/send-verification-email`, `/reset-password/:token`, `/callback/:id` | various | No UI call found — some are inert given the current config (e.g. no social providers means `/link-social`/`/callback/:id` have nothing to link to; `requireEmailVerification: false` means `/verify-email` is never enforced) |

### Request / response shapes

Not documented endpoint-by-endpoint here — they are Better Auth's own contract, versioned by the
`better-auth` package, not by BOND OS application code. The BOND-OS-authored Zod schemas that
validate the *client-side forms* calling into these endpoints live in
`packages/shared/src/schemas/auth.ts`:

```ts
signUpSchema        // { name, email, password }         — 8-128 char password
signInSchema         // { email, password, rememberMe? }  — rememberMe defaults true
forgotPasswordSchema // { email }
resetPasswordSchema  // { token, password }
changePasswordSchema // { currentPassword, newPassword }
```

These validate the request *before* it reaches `authClient`, not the wire format Better Auth
itself expects — treat them as the closest BOND-OS-owned approximation of each endpoint's body.

### Session model (summary)

Sessions are database-backed (`Session` table, joined to `User`), 7-day expiry with a 1-day
`updateAge` rolling refresh, cookie name prefixed `bondos` (`advanced.cookiePrefix`), a 5-minute
`cookieCache` so most requests don't hit the database at all. Full detail — the middleware/route
two-layer gating model, `requireAuth()`/`requireRole()`, cookie flags, what's explicitly not built
(email verification, MFA, OAuth/social login, magic links) — is in
[Authentication](../security/authentication.md); this document does not repeat it.

### Errors

Better Auth's own error shape, not BOND OS's `{ success: false, error: {...} }` envelope. Expect
its own `{ message, code? }`-style JSON on 4xx (e.g. wrong password, duplicate email at sign-up),
sourced from the `better-auth` package, not from `@bond-os/shared`'s `AppError` hierarchy.

---

## `GET /api/user` — Current User Profile

**Method / Path**: `GET /api/user`
**File**: `apps/web/app/api/user/route.ts`
**Auth**: `requireAuth()` only (no organization scoping).

### Response — `200`

```json
{
  "success": true,
  "data": {
    "id": "user_88ee1a2b...",
    "name": "Priya Salgotra",
    "email": "priya@acme.com",
    "avatar": "https://.../avatars/user_88ee1a2b-....png",
    "emailVerified": false
  }
}
```

`avatar` is `User.image` renamed at the DTO boundary (the same `image` → `avatar` convention every
`UserSummary` in this codebase uses — see `packages/database/src/repositories/shared.ts`).

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |

---

## `PATCH /api/user` — Update Current User Profile

**Method / Path**: `PATCH /api/user`
**File**: `apps/web/app/api/user/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()`.

### Body — `updateProfileSchema`

```ts
{
  name?: string;         // 1-120 chars, trimmed
  avatar?: string | null; // must be a valid URL
  firstName?: string | null;  // max 120
  lastName?: string | null;   // max 120
  title?: string | null;      // max 120
  department?: string | null; // max 120
  phone?: string | null;      // max 40
  timezone?: string | null;   // max 80
}
```

**Only `name` and `avatar` are actually persisted.** The route handler reads `body.name` and
`body.avatar` off the parsed input and writes exactly those two fields to `User.name`/`User.image`
(`apps/web/app/api/user/route.ts:25-28`) — `firstName`, `lastName`, `title`, `department`, `phone`,
and `timezone` all pass Zod validation (they're valid, accepted fields on the schema) but are
silently dropped before the `prisma.user.update` call. This is a genuine schema/route mismatch in
the current code, not a documentation simplification — if a caller submits those fields expecting
them to save, they won't.

### Example request

```json
{ "name": "Priya R. Salgotra", "avatar": "https://.../avatars/new.png" }
```

### Response — `200`

Same shape as `GET /api/user` above, reflecting only the two fields that were actually written.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin` header. |
| 422 | `VALIDATION_ERROR` | `name` empty/over-length, or `avatar` not a valid URL. |

---

## `POST /api/user/avatar` — Upload Avatar

**Method / Path**: `POST /api/user/avatar`
**File**: `apps/web/app/api/user/avatar/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()`.

Multipart file upload — not JSON. Uploads to the `avatars` bucket via `uploadPublicFile`
(`apps/web/lib/supabase.ts`) and immediately writes the resulting public URL to `User.image`, so
this one call both uploads the file and updates the profile (there is no separate "confirm" step).

### Body — `multipart/form-data`

| Field | Type | Notes |
|---|---|---|
| `file` | File | required; `image/png`, `image/jpeg`, or `image/webp` only; max 5MB |

### Response — `200`

```json
{ "success": true, "data": { "avatar": "https://.../avatars/user_88ee1a2b-....png" } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin` header. |
| 422 | `VALIDATION_ERROR` | No `file` field, unsupported MIME type, or file exceeds 5MB. |

### Notes

- Filenames are `${user.id}-${crypto.randomUUID()}.${ext}` — collision-proof, and the random suffix
  means a re-uploaded avatar doesn't overwrite the previous file's storage key (the old file is
  never explicitly deleted — only the `User.image` pointer is updated).
- Identical shape/limits/logic to `POST /api/organization/[id]/logo` (see
  [Organizations API](./organizations.md)) — same `ALLOWED_TYPES`/`MAX_FILE_SIZE` constants,
  duplicated per-route rather than shared.

## Related docs

- [Authentication](../security/authentication.md) — the session mechanism, cookies, middleware,
  and what's explicitly not built.
- [Authorization](../security/authorization.md) / [Permissions](../security/permissions.md) — the
  `requireRole()` layer every other surface in this reference builds on.
- [Organizations API](./organizations.md) — `requireActiveOrganizationId()`, the org-resolution
  primitive every org-scoped route (i.e. almost everything outside this file) uses.
