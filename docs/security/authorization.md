# Authorization

How BOND OS decides whether an *authenticated* caller is allowed to do a specific thing. Covers
`requireRole()`, the `ROLE_HIERARCHY`/`roleSatisfies()` comparison, the two distinct request-gating
patterns used across the API surface, CSRF (`assertSameOrigin`), and the resource-level (ownership)
checks layered on top of role checks in a handful of features.

This document is about the *mechanism* of authorization — the primitives and where they're called.
For the actual outcome ("what can an OWNER/ADMIN/MEMBER do, feature by feature"), see
[Permissions](./permissions.md). For how the *organization* itself is resolved and scoped, see
[Organization Isolation](./organization-isolation.md). For identity, see
[Authentication](./authentication.md).

## Table of contents

- [The primitive: `requireRole()`](#the-primitive-requirerole)
- [`ROLES`, `ROLE_HIERARCHY`, `roleSatisfies()`](#roles-role_hierarchy-rolesatisfies)
- [`getMembership()` — the single source of truth](#getmembership--the-single-source-of-truth)
- [Two request-gating patterns](#two-request-gating-patterns)
- [CSRF: `assertSameOrigin()`](#csrf-assertsameorigin)
- [Beyond role: resource-level (ownership) authorization](#beyond-role-resource-level-ownership-authorization)
- [Dynamic role requirements: the approval gate](#dynamic-role-requirements-the-approval-gate)
- [Error semantics](#error-semantics)
- [What is not built](#what-is-not-built)
- [See also](#see-also)

```mermaid
flowchart TD
    A[Route Handler] --> B{assertSameOrigin\nmutating routes only}
    B -- fails --> E1[403 ForbiddenError]
    B -- ok / GET --> C{requireRole(organizationId, minimumRole)}
    C --> D1[requireAuth internally]
    D1 -- no session --> E2[401 AuthError]
    D1 -- session ok --> D2[getMembership(userId, organizationId)]
    D2 -- no membership row --> E3[403 ForbiddenError]
    D2 -- membership found --> D3{roleSatisfies(membership.role, minimumRole)}
    D3 -- false --> E3
    D3 -- true --> F["{ session, membership }"]
    F --> G[Service layer runs]
    G --> H{Resource-level check?\ne.g. author-or-admin, creator-or-admin}
    H -- present and fails --> E3
    H -- absent, or passes --> I[Repository query, org-scoped]
```

## The primitive: `requireRole()`

`packages/auth/src/session.ts:30-39`:

```ts
export async function requireRole(organizationId: string, minimumRole: Role) {
  const session = await requireAuth();
  const membership = await getMembership(session.user.id, organizationId);

  if (!membership || !roleSatisfies(membership.role, minimumRole)) {
    throw new ForbiddenError();
  }

  return { session, membership };
}
```

Every protected write (and most protected reads) in the codebase ultimately calls either
`requireAuth()` (identity only — see [Authentication](./authentication.md)) or `requireRole()`
(identity + role floor). There is no third primitive. `requireRole`:

1. Calls `requireAuth()` first — throws `AuthError` (401) if there's no session at all.
2. Looks up the caller's `Membership` row for `organizationId` via `getMembership()`.
3. Throws `ForbiddenError` (403) if there's no membership row (the user isn't in this org at all) *or*
   the membership's role doesn't satisfy `minimumRole` per `roleSatisfies()`.
4. On success, returns `{ session, membership }` — callers that need the caller's own role
   (to compare against something computed dynamically, e.g. an approval's `requiredRole`) destructure
   `membership.role` from this return value rather than re-querying it.

A grep across `apps/web` turns up **173 call sites** of `requireRole(...)` — in `apps/web/app/api/**`
route handlers directly (mostly the URL-scoped organization/workspace routes — see below) and,
overwhelmingly, inside `apps/web/features/*/services/*.service.ts` files (the cookie-scoped pattern).
This is the mechanism behind every row in the [Permissions](./permissions.md) matrix.

## `ROLES`, `ROLE_HIERARCHY`, `roleSatisfies()`

`packages/shared/src/constants.ts:1-19`:

```ts
export const ROLES = { OWNER: 'OWNER', ADMIN: 'ADMIN', MEMBER: 'MEMBER' } as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_HIERARCHY: Record<Role, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

export function roleSatisfies(role: Role, required: Role): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[required];
}
```

- Exactly **three roles**, mirroring the Prisma `Role` enum (`packages/database/prisma/schema.prisma:62-66`)
  1:1 — `ROLES` is not a superset or subset of the DB enum, it's the same three values re-typed for
  application code.
- **`roleSatisfies` is a strict numeric floor comparison** — `OWNER` (3) satisfies any requirement;
  `ADMIN` (2) satisfies `ADMIN` and `MEMBER` requirements but not `OWNER`; `MEMBER` (1) only satisfies
  `MEMBER`. There is no lateral/orthogonal permission model (no "can edit but not delete" independent
  of the hierarchy) — every gate in the codebase is expressed as "at least this role," never as an
  arbitrary permission set.
- **Role is per-organization, not global.** It lives on `Membership.role`
  (`schema.prisma:369-383`, `@default(MEMBER)`), not on `User`. The same person can be `OWNER` of one
  organization and `MEMBER` of another; `requireRole` always takes an explicit `organizationId` and
  looks up that specific membership — there is no "global admin" concept anywhere in the codebase.
- `roleSatisfies` is also called directly (not via `requireRole`) wherever a check needs to compare an
  *already-resolved* role against a *dynamically computed* requirement — e.g. `ApprovalService.approve`
  (`apps/web/features/approvals/services/approval.service.ts:73`, comparing the caller's role against
  a plan's own `requiredRole`), or the author-or-admin checks described in
  [Beyond role](#beyond-role-resource-level-ownership-authorization) below.

## `getMembership()` — the single source of truth

`packages/database/src/queries/organizations.ts:61-65`:

```ts
export function getMembership(userId: string, organizationId: string) {
  return prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
}
```

A single `findUnique` against the `Membership` table's `@@unique([userId, organizationId])` constraint
(`schema.prisma:380`). This is the *only* function `requireRole` calls to resolve "what role does this
user have here" — there is no cached/denormalized copy of role anywhere else that authorization logic
reads from (the session cookie carries no role claim; role is always resolved fresh, per call, from
this table).

## Two request-gating patterns

Reading across the whole API surface (organization/member management, company data CRUD, Phase 2–9
features), two distinct patterns coexist, differentiated by where `organizationId` comes from:

### 1. URL-scoped, direct `requireRole` (no service layer)

`apps/web/app/api/organization/**` and `apps/web/app/api/workspace/[organizationId]/**` take the
organization id straight from the URL path and call `requireRole(id, ROLE)` right inside the route
handler — there is no intermediate `*.service.ts` file; the handler talks to `prisma` directly. Example
(`apps/web/app/api/organization/[id]/route.ts:22-25`):

```ts
export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  await requireRole(id, ROLES.ADMIN);
  // ...prisma.organization.update(...) directly
});
```

This pattern is used exactly where the resource *is* the organization or something org-identity-shaped
(`organization/[id]`, `organization/[id]/logo`, `organization/[id]/members/**`,
`workspace/[organizationId]`) — cases where the id in the URL unambiguously *is* the org the caller is
asking about, so there's no "which org is this for" ambiguity to resolve from a cookie.

### 2. Cookie-scoped, two-layer (route → service)

Every other feature — Projects, Tasks, Documents, Meetings, Customers, Emails, Library, Connectors,
Sync, the Knowledge Graph, Embeddings/Retrieval, Bond conversations, Agents, Workflows,
Execution/Approvals, Comments, Notifications, Spaces, Presence, Activity — resolves `organizationId`
from the `bondos_active_org` cookie via `requireActiveOrganizationId()`
(`apps/web/lib/organization.ts:42-49`; see [Organization Isolation](./organization-isolation.md) for
the cookie mechanics), then delegates to a `features/*/services/*.service.ts` function that calls
`requireRole(organizationId, ROLES.X)` **again**, independently, as its own gate. Example
(`apps/web/features/tasks/services/task.service.ts:68-74`):

```ts
// route: apps/web/app/api/tasks/route.ts
const organizationId = await requireActiveOrganizationId(); // auth-gates, resolves org from cookie
const body = await parseJsonBody(request, createTaskSchema);
await createTaskService(organizationId, body);

// service: apps/web/features/tasks/services/task.service.ts
export async function createTaskService(organizationId: string, input: CreateTaskInput) {
  await requireRole(organizationId, ROLES.MEMBER);   // the real authorization check
  await assertProjectInOrg(organizationId, input.projectId);
  await assertAssigneeInOrg(organizationId, input.assigneeId);
  return createTaskRow({ organizationId, ...input });
}
```

This means **the route layer establishes identity and "which org," the service layer establishes "is
this identity allowed here."** Several routes read this way on purpose — `GET /api/activity`,
`GET /api/comments`, `POST /api/comments/[id]/unresolve`, and `GET /api/spaces/[id]` never call
`requireAuth()` themselves, only `requireActiveOrganizationId()` — but they are still fully
authenticated, because `requireActiveOrganizationId()` calls `requireAuth()` as its own first line
(`apps/web/lib/organization.ts:43`), and the service function they delegate to calls `requireRole`
independently. Authorization is enforced twice on the request path in the common case (once implicitly
via the cookie resolver, once explicitly in the service), which is deliberate defense in depth rather
than redundant boilerplate: a service function is reusable from multiple call sites (HTTP routes,
Server Components, other services), and each one gets the same guarantee without having to trust its
caller already checked.

A small number of endpoints intentionally skip `requireRole` at the *route* layer even though the
resource they touch is real — e.g. `POST /api/execution/plan` calls only `requireAuth()` +
`requireActiveOrganizationId()`, with no role floor beyond "is a member of this org" (which is
automatically true for any role, since `MEMBER` is the lowest tier) — because the real, plan-specific
authorization check happens later, at approval time (see
[Dynamic role requirements](#dynamic-role-requirements-the-approval-gate)).

## CSRF: `assertSameOrigin()`

`apps/web/lib/csrf.ts:13-26`:

```ts
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) {
    throw new ForbiddenError('Missing Origin header.');
  }
  const allowed = new URL(getEnv().APP_URL).origin;
  if (origin !== allowed) {
    throw new ForbiddenError('Cross-origin request rejected.');
  }
}
```

This is the first line of nearly every mutating (POST/PATCH/DELETE) Route Handler in the codebase —
confirmed at, among many others, `organization/[id]/route.ts`, `organization/[id]/members/route.ts`,
`execution/plan/route.ts`, `execution/[id]/approve/route.ts`, `comments/route.ts`,
`spaces/route.ts`. GET handlers never call it (they're not state-changing, so cross-origin reads are
not the threat this defends against). It's conceptually part of the authorization chain, not a
separate subsystem — a request has to clear `assertSameOrigin` *before* `requireAuth`/`requireRole`
even runs, so a forged cross-origin request is rejected before identity is even checked.

Rationale, per the function's own doc comment (`csrf.ts:4-12`): Better Auth's own `/api/auth/*`
endpoints protect themselves separately via `trustedOrigins` (`server.ts:28` — see
[Authentication](./authentication.md)); `assertSameOrigin` is BOND OS's equivalent for its *own*
mutating routes. It's deliberately simpler than a hand-rolled double-submit-cookie token scheme: a
same-origin `fetch()` always sends an `Origin` header on state-changing methods, so a **missing**
header on a mutating request is itself treated as suspicious and rejected outright, not passed through.

Two routes are deliberately exempt, because they authenticate a different way entirely (no session at
all): `POST /api/workflows/schedule/tick` (bearer `CRON_SECRET`) and
`POST /api/workflows/webhook/[id]` (HMAC-signed external webhook) — see
[Workflows › Scheduler](../workflows/scheduler.md) for those two boundaries.

## Beyond role: resource-level (ownership) authorization

`ROLE_HIERARCHY` alone answers "what's this user's floor in this org," not "do they own *this specific
row*." A handful of features layer an additional, resource-level check on top of the `requireRole`
floor, using `roleSatisfies` directly for an ad hoc comparison rather than a second `requireRole` call:

- **Comments** (`apps/web/features/comments/services/comment.service.ts`) — every method still calls
  `requireRole(organizationId, ROLES.MEMBER)` as the floor, but:
  - **Edit** (`updateCommentService`, line 164-173): `ForbiddenError` unless
    `comment.authorId === callerId` — **no admin override**; even an OWNER can't edit someone else's
    comment.
  - **Delete** (`deleteCommentService`, line 189-202): allowed if `comment.authorId === callerId`
    **or** `roleSatisfies(membership.role, ROLES.ADMIN)` — author *or* moderator.
  - **Attach a file** (`addCommentAttachmentService`, line 211-233): author-only, same as edit — no
    admin override.
  - **Resolve/unresolve** (lines 175-187): **any** org member (`MEMBER` floor only) — not restricted
    to the author, and with no moderator distinction either way.
- **Bond (Mr. Bond) conversations** (`apps/web/features/bond/services/conversation.service.ts:57-76`)
  — `assertConversationAccess(conversation, callerId, callerRole, level)` implements a three-tier
  model independent of org role: the conversation's creator always has full access; an org `ADMIN`+
  always has full access (`roleSatisfies(callerRole, ROLES.ADMIN)` short-circuits, line 65); anyone
  else needs an explicit `ConversationShare` row, and even then a `'manage'`-level action (rename,
  delete, re-share) is refused to a mere `'collaborate'`-level share — only `'read'` or `'collaborate'`
  are grantable via sharing. See the conditional structure below (`conversation.service.ts:57-76`):

  ```ts
  export async function assertConversationAccess(conversation, callerId, callerRole, level) {
    if (!conversation.createdBy) return;
    if (conversation.createdBy.id === callerId) return;
    if (roleSatisfies(callerRole, ROLES.ADMIN)) return;
    if (level === 'manage') throw new ForbiddenError('Only the conversation owner can manage this conversation.');
    const share = await getConversationShareForUser(conversation.id, callerId);
    if (!share) throw new ForbiddenError('You do not have access to this conversation.');
    if (level === 'collaborate' && share.permission !== 'COLLABORATE') {
      throw new ForbiddenError('You have read-only access to this conversation.');
    }
  }
  ```

- **Team Spaces** (`apps/web/features/spaces/services/space.service.ts:72-78`) —
  `assertCanManageSpace(callerId, callerRole, space)` is used for rename/delete/link-unlink-content/
  remove-other-member: `ForbiddenError` unless `space.createdBy?.id === callerId` **or**
  `roleSatisfies(callerRole, ROLES.ADMIN)`. Notably, mere Space *membership* is never itself checked as
  a gate anywhere in this file — see [Permissions § Spaces](./permissions.md#13-collaboration--comments-mentions-notifications-activity-presence-team-spaces) and
  [Organization Isolation](./organization-isolation.md) for why Spaces are curation, not an ACL.
- **Organization membership escalation guards** — not "ownership" in the resource sense, but the same
  family of "role alone isn't enough" logic: `POST /api/organization/[id]/members` and
  `PATCH .../members/[userId]` both require `ADMIN` via `requireRole`, then add an explicit,
  hand-written check that only an `OWNER` may grant or touch an `OWNER` membership
  (`organization/[id]/members/route.ts:49-51`, `organization/[id]/members/[userId]/route.ts:56-59,86-88`),
  and that an organization can never be left with zero `OWNER`s
  (`assertNotLastOwner`, `organization/[id]/members/[userId]/route.ts:30-38`). See
  [Permissions § Organization & Membership](./permissions.md#1-organization--membership) for the full
  breakdown.

In every one of these cases, the resource-level check runs **after** the `requireRole` floor, never
instead of it — a `MEMBER` who happens to own a resource still needs to be a `MEMBER`-or-above of the
org to reach the ownership check at all (this matters for e.g. a removed member: their membership row
being deleted makes `requireRole` fail before any ownership logic is even evaluated).

## Dynamic role requirements: the approval gate

Every check described so far compares a caller's role against a **statically known** floor
(`ROLES.MEMBER`, `ROLES.ADMIN`, `ROLES.OWNER` — a fixed constant in the calling code). The Tool
Execution Framework's approval gate is the one place in the codebase where the *required* role is
**computed at runtime**, per plan, and stored on the row rather than hard-coded at the call site:

- `PermissionService.requiredRoleForTools(tools)` (`apps/web/features/execution/services/permission.service.ts:12-19`)
  walks every tool a proposed plan would invoke and takes the **maximum** `ROLE_HIERARCHY` severity
  across each tool's own `permissions()` method:

  ```ts
  requiredRoleForTools(tools: AnyToolDefinition[]): Role {
    let required: Role = ROLES.MEMBER;
    for (const tool of tools) {
      const role = tool.permissions();
      if (ROLE_HIERARCHY[role] > ROLE_HIERARCHY[required]) required = role;
    }
    return required;
  }
  ```

  Of the 5 registered tools, 4 (`create_project`, `update_project`, `create_task`, `create_meeting`)
  declare `permissions: () => ROLES.MEMBER`; one (`archive_project`) declares
  `permissions: () => ROLES.ADMIN` — so a plan that mixes an `archive_project` step with any
  `MEMBER`-tier step requires `ADMIN` to approve the *whole plan*, not just that one step.
- `PlannerService.buildPlan` calls this once at plan-build time and `ApprovalService.requestApproval`
  writes the result onto `ApprovalRequest.requiredRole` (`approval.service.ts:36-51`) — it is **never
  client-supplied**, and nothing downstream recomputes or accepts an override.
- `ApprovalService.approve()` (`approval.service.ts:68-93`) is where the dynamic check actually runs:

  ```ts
  if (!roleSatisfies(callerRole, approval.requiredRole)) {
    throw new ForbiddenError(`Approving this plan requires the ${approval.requiredRole} role.`);
  }
  ```

  Note this is `roleSatisfies` called directly, not `requireRole` — because the "required role" isn't
  a compile-time constant, it's a value read off the `ApprovalRequest` row. The HTTP route
  (`POST /api/execution/[id]/approve`) still calls `requireRole(organizationId, ROLES.MEMBER)` first,
  but that's explicitly framed in the route's own comment as *only a floor* (proof of org membership
  plus the caller's live role) — the actual per-plan gate is the `roleSatisfies` call inside
  `approve()`.

This is the mechanism [Permissions](./permissions.md#11-execution--approvals) refers to when it says
Execution/Approval permissions can't be reduced to a single static row in the matrix. Full design
rationale (why a signature token was considered and rejected, single-use/replay protection via
`transitionApprovalRequest`'s atomic `updateMany`, `planHash` re-verification) lives in
[Workflows › Approvals](../workflows/approvals.md).

## Error semantics

Both authorization primitives map to distinct, meaningful HTTP statuses via `packages/shared/src/errors.ts`
and `apps/web/lib/api-handler.ts`'s `toErrorResponse()`:

| Failure | Error class | HTTP status | `code` |
|---|---|---|---|
| No session at all | `AuthError` | 401 | `AUTH_ERROR` |
| Session valid, but no membership in this org, or role too low | `ForbiddenError` | 403 | `FORBIDDEN` |
| Cross-origin / missing `Origin` on a mutating route | `ForbiddenError` | 403 | `FORBIDDEN` |

A caller can therefore always distinguish "you're not logged in" from "you're logged in but not
allowed" from the status code alone — `apiHandler` guarantees this for every route without each
handler having to build the response itself.

## What is not built

- **No fine-grained, per-resource ACL/permission model beyond role + the handful of ownership checks
  above.** There is no "share this specific Project with this specific user at this specific
  permission level" mechanism anywhere except Bond conversation sharing
  (`ConversationShare`) — Projects, Tasks, Customers, Documents, Meetings, Knowledge Documents, and
  every Knowledge Graph entity are visible to **every** member of the org (at `MEMBER` role or above),
  full stop; there is no owner-only or member-list-only visibility restriction on any of them.
- **No permission delegation** ("let X approve on my behalf," temporary role grants, time-boxed access).
- **Team Space membership is not an authorization boundary** — see
  [Organization Isolation](./organization-isolation.md) and
  [Permissions § Team Spaces](./permissions.md#13-collaboration--comments-mentions-notifications-activity-presence-team-spaces). Linking content into a Space never
  restricts who can see that content; it only curates.
- **No row-level security (RLS) at the Postgres level.** Every isolation and authorization guarantee
  described in this document and [Organization Isolation](./organization-isolation.md) is enforced
  entirely in application code (`requireRole`, org-scoped Prisma `where` clauses) — the database itself
  has no policy that would stop a bug in application code from crossing a tenant boundary.

## See also

- [Authentication](./authentication.md) — the session `requireAuth()` builds on.
- [Permissions](./permissions.md) — the full capability matrix this mechanism produces.
- [Organization Isolation](./organization-isolation.md) — how `organizationId` itself is resolved and
  scoped; the other half of every authorization check in this document.
- [Audit](./audit.md) — what gets recorded when a gated action (approve, execute, roll back) succeeds.
- [Workflows › Approvals](../workflows/approvals.md) — full design of the dynamic approval gate.
- [Threat Model](./threat-model.md) — CSRF, privilege escalation, and the threats this document's
  mechanisms are meant to close off.
- [`../api/organizations.md`](../api/organizations.md) — endpoint-level reference for the
  organization/membership routes cited above.
- [`../workflows/event-bus.md`](../workflows/event-bus.md) — `publishEvent()`, used by the approval
  gate and comment mentions to fan out `approval.*`/`comment.created` events.
