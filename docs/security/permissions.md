# Permissions

The full OWNER / ADMIN / MEMBER capability matrix — what each role can do, feature by feature, derived
directly from every `requireRole(...)` call site in `apps/web` (173 call sites across
`apps/web/app/api/**` and `apps/web/features/*/services/*.service.ts`, confirmed by repo-wide grep and
spot-verified by direct reading) plus the resource-level checks layered on top of them.

For the *mechanism* behind this table (how `requireRole` works, the two request-gating patterns, CSRF,
resource-level checks), see [Authorization](./authorization.md). For identity, see
[Authentication](./authentication.md). For how `organizationId` itself is resolved, see
[Organization Isolation](./organization-isolation.md).

## Table of contents

- [Quick reference](#quick-reference)
- [1. Organization & Membership](#1-organization--membership)
- [2. Your own account](#2-your-own-account)
- [3. Company Data — Projects, Tasks, Documents, Meetings, Customers, Emails](#3-company-data--projects-tasks-documents-meetings-customers-emails)
- [4. Library — Knowledge Documents, Folders, Tags](#4-library--knowledge-documents-folders-tags)
- [5. Connectors & Sync](#5-connectors--sync)
- [6. Knowledge Graph](#6-knowledge-graph)
- [7. AI Configuration & Retrieval](#7-ai-configuration--retrieval)
- [8. Mr. Bond (conversations)](#8-mr-bond-conversations)
- [9. Agents](#9-agents)
- [10. Workflows](#10-workflows)
- [11. Execution & Approvals](#11-execution--approvals)
- [12. Audit trail](#12-audit-trail)
- [13. Collaboration — Comments, Mentions, Notifications, Activity, Presence, Team Spaces](#13-collaboration--comments-mentions-notifications-activity-presence-team-spaces)
- [Cross-cutting patterns](#cross-cutting-patterns)
- [Notable exceptions and gaps](#notable-exceptions-and-gaps)
- [See also](#see-also)

## Quick reference

| Role | `ROLE_HIERARCHY` | Can do |
|---|---|---|
| **OWNER** | 3 | Everything ADMIN can, plus: delete the organization, grant or touch an `OWNER` membership. Every organization always has at least one. |
| **ADMIN** | 2 | Everything MEMBER can, plus: nearly every "delete" or "disconnect" action across Company Data/Library/Connectors, org profile edits, member management (except granting/touching `OWNER`), destructive AI-embedding operations, approving plans whose computed severity requires ADMIN. |
| **MEMBER** | 1 | The floor for the organization. Read everything in the org; create/update nearly everything; chat with Mr. Bond and Agents; propose and approve most action plans; comment, mention, join Spaces, manage notifications. |

Role is **per-organization** (`Membership.role`), not global — see
[Authorization § `ROLES`](./authorization.md#roles-role_hierarchy-rolesatisfies). "MEMBER" below always
means "at least `MEMBER`" (i.e. any of the three roles, since `roleSatisfies` is a floor check) unless
a row says otherwise.

## 1. Organization & Membership

Source: `apps/web/app/api/organization/**`, `apps/web/app/api/workspace/[organizationId]/**` — the
URL-scoped, direct-`requireRole` pattern (see [Authorization](./authorization.md#two-request-gating-patterns)).

| Action | Min. role | Notes | Source |
|---|---|---|---|
| List my own organizations | *(any authenticated user)* | `requireAuth()` only — lists every org the caller has a `Membership` in, with their role in each. | `organization/route.ts:8-12` |
| Create an organization | *(any authenticated user)* | `requireAuth()` only. Creates the org + its one `Workspace` + an `OWNER` membership for the creator, atomically. | `organization/route.ts:14-32`, `packages/database/src/queries/organizations.ts:17-33` |
| View an org's full profile | MEMBER | `prisma.organization.findUnique`. | `organization/[id]/route.ts:10-20` |
| Update org name/slug/logo | ADMIN | The schema also validates `description`/`website`/`industry`/`size`, but the handler never writes them — a real gap between schema and implementation, not a permission distinction. | `organization/[id]/route.ts:22-40` |
| Upload/replace org logo | ADMIN | Multipart upload, hand-validated (no Zod schema): PNG/JPEG/WEBP, ≤5MB. | `organization/[id]/logo/route.ts:18-47` |
| **Delete the organization** | **OWNER** | The only `ROLES.OWNER`-gated route in the codebase. Cascades to nearly every child table (`onDelete: Cascade`). | `organization/[id]/route.ts:42-50` |
| List members | MEMBER | | `organization/[id]/members/route.ts:30-41` |
| Add a member (by email) | ADMIN | No invite flow — the target must already have a BOND OS account, or this 404s. **Only an OWNER may grant the `OWNER` role**; an ADMIN can add MEMBER/ADMIN members but is rejected with `ForbiddenError` if `body.role === 'OWNER'`. | `organization/[id]/members/route.ts:43-71` |
| Change a member's role | ADMIN | **Only an OWNER may touch a currently-OWNER membership or grant `OWNER`.** Demoting the org's last OWNER is blocked (`assertNotLastOwner`, counts `role: 'OWNER'` memberships, requires ≥2 before allowing a demotion). | `organization/[id]/members/[userId]/route.ts:40-72` |
| Remove a member | ADMIN | Same OWNER-only-touches-OWNER and last-owner protections as role change. | `organization/[id]/members/[userId]/route.ts:74-99` |
| View the (placeholder) Workspace record | MEMBER | URL-scoped like the routes above, not cookie-scoped. `Workspace` has no user-editable fields yet — no POST/PATCH/DELETE exists. | `workspace/[organizationId]/route.ts:9-19` |

## 2. Your own account

Source: `apps/web/app/api/user/**`. These have **no organization or role dimension at all** —
`requireAuth()` only, because the resource is always the caller's own `User` row.

| Action | Gate | Notes |
|---|---|---|
| View my profile | `requireAuth()` | Returns `{id, name, email, avatar, emailVerified}` off the session. |
| Update my profile | `requireAuth()` | Only `name`/`avatar` (mapped to `image`) are actually persisted — `firstName`/`lastName`/`title`/`department`/`phone`/`timezone` validate against the schema but are silently dropped by the handler, even though `User` has all those columns. |
| Upload/replace my avatar | `requireAuth()` | Same hand-rolled MIME/size validation as the org logo upload. |

## 3. Company Data — Projects, Tasks, Documents, Meetings, Customers, Emails

Source: `apps/web/features/{projects,tasks,documents,meetings,customers,emails}/services/*.service.ts`,
all using the cookie-scoped two-layer pattern (`requireActiveOrganizationId()` at the route,
`requireRole()` again in the service). **Every one of these six entities follows the identical
"list/get/create/update = MEMBER, delete = ADMIN" shape** — the dominant convention in the whole
codebase:

| Entity | List / Get | Create | Update | Delete | Notable deviation |
|---|---|---|---|---|---|
| Project | MEMBER | MEMBER | MEMBER (+ optimistic-lock `expectedVersion`) | **ADMIN** | — |
| Task | MEMBER (list only — **no `GET /api/tasks/[id]` route exists**) | MEMBER | MEMBER | **ADMIN** | Single-task fetch has no REST endpoint at all, even though `getTaskService` exists and is used internally. |
| Document (Phase 1, project/meeting-scoped) | MEMBER | MEMBER (multipart upload, no virus scan) | MEMBER (metadata only) | **ADMIN** | Deleting does *not* remove the underlying Supabase storage object. |
| Meeting | MEMBER | MEMBER | MEMBER | **ADMIN** | — |
| Customer | MEMBER | MEMBER | MEMBER | **ADMIN** | — |
| Email (metadata log, not live mail sync) | MEMBER (list only — **no `GET /api/emails/[id]` route or `getEmailById` function exists at all**) | MEMBER | MEMBER | **ADMIN** | No workflow event is published on email create/update, unlike the other five. |

Every create/update on these six also runs an org-membership check on any *referenced* id
(owner/assignee/attendee/project/customer) before writing — see
[Organization Isolation § cross-entity validation](./organization-isolation.md#cross-entity-soft-fk-validation).
Deleting a Project/Task/Document/Meeting/Customer also cascades a `deleteCommentsForEntity` call
(Phase 9); deleting an Email does not, since Comments were never wired to the `EMAIL` entity type.

Source line references: `apps/web/features/{projects,tasks,documents,meetings,customers,emails}/services/*.service.ts`
(each file's `requireRole` calls follow the pattern above in file order — list/get near the top,
delete last).

## 4. Library — Knowledge Documents, Folders, Tags

Source: `apps/web/features/library/services/{library,folder,tag}.service.ts`. The Phase 2 ingestion
system — structurally distinct from the "Documents" above (see
[Organization Isolation](./organization-isolation.md) and [Data Layer](../database/schema.md)).

| Action | Min. role | Notes |
|---|---|---|
| List / get a Knowledge Document | MEMBER | |
| Upload a Knowledge Document | MEMBER | Virus-scanned, parsed, chunked, entity-extracted, and embedded **synchronously in the request** — the richest single write path in the codebase. |
| Update Knowledge Document metadata | MEMBER | |
| **Delete a Knowledge Document** | **ADMIN** | Also deletes the underlying Supabase storage object (`deletePublicFile`) — unlike the Phase 1 Document delete path. |
| List / create a Folder | MEMBER | |
| Rename a Folder | MEMBER | |
| **Delete a Folder** | **ADMIN** | |
| List / create a Tag | MEMBER | Create is idempotent (`findOrCreateTag`, unique on `[organizationId, name]`). |
| Delete a Tag | **ADMIN** | **Defined (`tag.service.ts:15-19`) but dead code — no route calls it.** Tags can be created and listed but never deleted through the API. |

## 5. Connectors & Sync

Source: `apps/web/features/{connectors,sync}/services/*.service.ts`.

| Action | Min. role | Notes |
|---|---|---|
| List connectors (catalog + connection status) | MEMBER | |
| Connect a connector | MEMBER | |
| **Disconnect a connector** | **ADMIN** | |
| Trigger a manual sync | MEMBER | Every provider's `.sync()` is currently a stub that always throws `ConnectorNotImplementedError` — a `FAILED` `SyncJob` is the correct, expected result today, not a bug. |
| List sync job history | MEMBER | |

## 6. Knowledge Graph

Source: `apps/web/features/graph/services/graph.service.ts`.

| Action | Min. role | Notes |
|---|---|---|
| View/search entities, relationships, timeline (per-entity or org-wide) | MEMBER | |
| Create a relationship between two entities | MEMBER | Both entities must already exist in the caller's org (`findFirst({id, organizationId})` on each) or `NotFoundError`. |
| **Delete a relationship** | **ADMIN** | The only ADMIN-gated action in this entire feature area — entity creation/editing itself is not exposed as a separate role-gated action distinct from ingestion (see [Knowledge › Graph](../knowledge/graph.md)). |

## 7. AI Configuration & Retrieval

Source: `apps/web/features/{ai,bond,retrieval,embeddings}/services/*.service.ts`.

| Action | Min. role | Notes |
|---|---|---|
| View AI provider/model config, health, audit stats (`ai.service.ts`) | MEMBER | Read-only surface over `@bond-os/ai`; `generate()`/`stream()` exist but aren't reachable from any page yet. |
| View the org's AI settings (`OrganizationAiSettings`) | MEMBER | |
| **Update the org's AI settings** (provider/model/temperature/etc.) | **ADMIN** | Also validates the chosen provider is actually configured (has an API key) before saving. |
| Resolve the effective AI config for a request (env defaults merged with org overrides) | MEMBER | |
| Retrieval, memory (facts), citations, context-builder reads | MEMBER | Every function across `retrieval.service.ts`, `memory.service.ts`, `citation.service.ts`, `context-builder.service.ts`, `document-info.service.ts`. |
| View embedding stats / embedding job history | MEMBER | |
| Generate/re-generate embeddings for one document/source | MEMBER | |
| **Rebuild every embedding in the org** (delete + regenerate all) | **ADMIN** | Explicitly framed in the code as "the heavy, explicit 'I changed providers/dimensions' operation... destructive and expensive." |
| **Delete a single embedding** | **ADMIN** | |

## 8. Mr. Bond (conversations)

Source: `apps/web/features/bond/services/{conversation,conversation-memory,message,cost-tracking,rag-pipeline}.service.ts`.
This is the one area where a **resource-ownership model runs on top of** the role floor — see
[Authorization § Beyond role](./authorization.md#beyond-role-resource-level-ownership-authorization)
for the full `assertConversationAccess` breakdown.

| Action | Min. role | Additional gate |
|---|---|---|
| List / create a conversation, send a message, chat (RAG pipeline) | MEMBER | — |
| View a conversation | MEMBER | `'read'` access: creator, an org ADMIN+, or an explicit share (any permission level). |
| Rename / delete / share a conversation | MEMBER | `'manage'` access: **creator or org ADMIN+ only** — a `'collaborate'`-level share is *not* enough. |
| Post into a shared conversation | MEMBER | `'collaborate'` access: creator, ADMIN+, or a share with `permission: 'COLLABORATE'` specifically (a `'read'`-only share is rejected). |
| Conversation memory (facts extracted from chat) reads/writes | MEMBER | |
| Cost-tracking reads | MEMBER | |
| **Archive conversations older than N days (org-wide bulk action)** | **ADMIN** | The manual "Archive old conversations" admin action — no background worker runs this automatically. |

## 9. Agents

Source: `apps/web/features/agents/services/*.service.ts` (chat, discovery, delegation, observations,
context preview, insights, goals, timeline, pipeline).

| Action | Min. role |
|---|---|
| Chat with an agent, discover available agents, delegate a task between agents | MEMBER |
| View agent observations, context previews, insights (create/list/read/dismiss), timeline | MEMBER |
| Create, advance, cancel a long-running Goal (Plan → Observe → Suggest → Wait → Continue) | MEMBER |

**There is no ADMIN-gated action anywhere in the Agents feature area** — every one of the 20+
`requireRole` call sites across every agent service file requires only `MEMBER`. This is a genuine,
verified deviation from the "destructive/expensive action needs ADMIN" convention seen in Company
Data, Library, Connectors, and Embeddings — see [Notable exceptions](#notable-exceptions-and-gaps).

## 10. Workflows

Source: `apps/web/features/workflows/services/{workflow-definition,workflow-run.query-service}.ts`.

| Action | Min. role |
|---|---|
| Create a workflow definition (as a DRAFT) | MEMBER |
| View / list workflow definitions | MEMBER |
| Update a DRAFT's graph | MEMBER |
| **Publish** a DRAFT into an immutable, versioned ACTIVE definition | MEMBER |
| **Disable** an ACTIVE definition | MEMBER |
| List / view workflow runs | MEMBER |

**There is no ADMIN-gated action anywhere in Workflow Definitions or Workflow Runs either** —
every `requireRole` call in both service files requires only `MEMBER`, including *publish* (which
freezes a graph that can invoke tools/agents against a real approval gate once triggered) and
*disable* (the closest thing to a delete this model has, since published versions are immutable).
Compare this to Company Data, where the equivalent lifecycle-ending action (delete) is uniformly
ADMIN-gated. See [Notable exceptions](#notable-exceptions-and-gaps). Publishing a definition with a
write step (`INVOKE_TOOL`/`INVOKE_AGENT`) does require the definition to already have an `ownerId` set
— that's a data-completeness validation, not a role check.

## 11. Execution & Approvals

Source: `apps/web/app/api/execution/**`, `apps/web/features/{approvals,execution,planner}/services/*.ts`.
This is the one area where "minimum role" is not a fixed constant — see
[Authorization § Dynamic role requirements](./authorization.md#dynamic-role-requirements-the-approval-gate)
for the full mechanism.

| Action | Gate | Notes |
|---|---|---|
| Propose a plan (`POST /api/execution/plan`, or Mr. Bond's `<<ACTION:...>>` detection) | `requireAuth` + `requireActiveOrganizationId` — **no `requireRole` call at all** | Building a plan is available to any authenticated org member; MEMBER is the org floor anyway, so this isn't a materially lower bar than everything else, just a code path with no explicit role check. |
| **Approve a plan** (`POST /api/execution/[id]/approve`) | `requireRole(organizationId, ROLES.MEMBER)` **as a floor only**, then `roleSatisfies(callerRole, approval.requiredRole)` inside `ApprovalService.approve()` | `requiredRole` is computed per-plan by `PermissionService.requiredRoleForTools` — the maximum severity across every tool step. 4 of 5 registered tools are `MEMBER`-tier; `archive_project` is `ADMIN`-tier, so any plan including it needs ADMIN to approve. Rate-limited: 20 req/60s. |
| **Reject a plan** (`POST /api/execution/[id]/reject`) | `requireActiveOrganizationId` only — **no `requireRole` call, and not rate-limited** | Deliberately asymmetric with approve: rejecting only prevents a write, never causes one, so any org member can reject regardless of the plan's `requiredRole`. |
| View execution history / a plan's audit trail | MEMBER | Gated *inside* `AuditService.listForExecution`/`execution-history.service.ts`, not by the route itself. |
| List available tools (Tool Discovery) | MEMBER | |
| A tool's own `execute()` (once a plan is approved) | Per-tool `permissions()` — the value that feeds `requiredRoleForTools` | 4 of 5 reference tools: `MEMBER`. `archive_project`: `ADMIN`. |

## 12. Audit trail

Source: `apps/web/features/audit/services/audit.service.ts`.

| Action | Gate |
|---|---|
| View an execution's audit trail | MEMBER (`AuditService.listForExecution`) |
| Write an audit event | *No public endpoint at all* — `AuditService.record()` has no authorization check of its own; it's only ever called internally by trusted service code (`ExecutionService`, `RollbackService`), never exposed as a route. |

Full detail on what's actually recorded (5 real action types vs. the model's broader illustrative
comment) is in [Audit](./audit.md).

## 13. Collaboration — Comments, Mentions, Notifications, Activity, Presence, Team Spaces

Source: `apps/web/features/{comments,notifications,activity,collaboration,spaces}/services/*.ts`.

| Feature | Action | Min. role | Additional gate |
|---|---|---|---|
| Comments | List / create a comment | MEMBER | Target entity must exist in the org (`assertEntityExists`); any `@user`/`@space`/`@agent` mention must resolve inside the org / Agent Registry. |
| Comments | Edit a comment | MEMBER | **Author only — no admin override, ever.** |
| Comments | Delete a comment | MEMBER | **Author or org ADMIN+.** |
| Comments | Resolve / unresolve a comment | MEMBER | **Any org member** — not restricted to the author, no moderator distinction. |
| Comments | Attach a file to a comment | MEMBER | **Author only**, same as edit. |
| Mentions | List mentions naming me | MEMBER | Always the caller's own; there's no "list mentions for another user." |
| Notifications / Inbox | List / mark read / mark all read / archive / snooze | MEMBER | Always scoped to `userId = caller` in the `WHERE` clause — structurally cannot touch another user's notifications, independent of role. |
| Activity Feed | View org-wide activity | MEMBER | A read view over the pre-existing `Event` table; no actor/user filter exists (`Event` has no actor column at all). |
| Presence | Post a heartbeat | `requireAuth` + `requireActiveOrganizationId` — **no `requireRole` call anywhere in `presence.service.ts`** | Rate-limited 8 req/60s, IP-keyed. Presence reads happen only via the SSE channel, not a dedicated endpoint. |
| Team Spaces | List / view a Space, join, leave | MEMBER | Joining is self-service (any org member can join any Space); there's no invite-only Space. |
| Team Spaces | Create a Space | MEMBER | Creator is automatically added as a member. |
| Team Spaces | Rename / delete a Space, remove *another* member, link/unlink Projects/Knowledge Documents/Workflows/Agents into it | MEMBER | **Creator or org ADMIN+** (`assertCanManageSpace`) — despite living under a self-joinable resource, this is a manage-tier check, not mere membership. |
| Team Spaces | *(Visibility of content linked into a Space)* | — | **Not gated by Space membership at all.** See [Organization Isolation § Team Spaces](./organization-isolation.md#team-spaces-curation-not-isolation) — linking something into a Space never restricts who in the org can see it. |

Full endpoint-level detail for this whole surface: [`../api/collaboration.md`](../api/collaboration.md).

## Cross-cutting patterns

1. **"List/get/create/update = MEMBER, delete = ADMIN" is the dominant convention** — it holds for
   Projects, Tasks, Documents, Meetings, Customers, Emails, Knowledge Documents, Folders, Tags,
   Connectors (disconnect), Embeddings (rebuild-all and delete-single), and the Knowledge Graph
   (delete-relationship). If a feature isn't listed as a documented exception below, assume this shape.
2. **OWNER is reserved for exactly two things**: deleting the organization itself, and
   granting/touching an `OWNER`-level membership. Every other action an OWNER can do, an ADMIN can also
   do (OWNER's extra privilege is additive on top of ADMIN, per `ROLE_HIERARCHY`, not a disjoint set).
3. **A "last owner" can never be removed or demoted** — enforced by `assertNotLastOwner`
   (`organization/[id]/members/[userId]/route.ts:30-38`), independent of who's making the request.
4. **Resource ownership sometimes overrides or narrows the role floor**: Comment edit/attach (author
   only, no admin override), Comment delete (author-or-admin), Bond conversation manage (creator-or-
   admin), Space manage (creator-or-admin). In every case the `MEMBER` role floor is checked *first* —
   ownership checks never substitute for org membership.
5. **A few reads are inherently self-scoped rather than role-scoped**: your own notifications, your
   own mentions, your own account profile — the `WHERE userId = caller` clause (or lack of any
   `organizationId`/role dimension at all for the account routes) does this narrowing, not
   `ROLE_HIERARCHY`.

## Notable exceptions and gaps

Stated plainly, since these are real deviations from the dominant pattern above, not doc-writer error:

1. **Workflows (definitions and runs) have zero ADMIN-gated actions.** Publish and disable — the two
   actions structurally closest to "delete" for an immutable, versioned model — both require only
   `MEMBER`. Every other lifecycle-ending action elsewhere in the codebase (Project/Task/Document/
   Meeting/Customer/Email/KnowledgeDocument/Folder delete, Connector disconnect) is ADMIN-gated.
2. **Agents (chat, discovery, delegation, observations, insights, Goals) have zero ADMIN-gated
   actions anywhere** — including creating and cancelling a Goal, which is the closest thing this
   feature area has to a destructive/lifecycle-ending action.
3. **Tag delete (`deleteTagService`, ADMIN-gated) is dead code** — defined but never called from any
   route. There is functionally no way to delete a Tag through the API today.
4. **Presence has no `requireRole` call anywhere** — not even a `MEMBER` floor. It relies entirely on
   `requireActiveOrganizationId()` (which only proves org membership, not a role), unlike literally
   every other mutating action in the codebase, which explicitly calls `requireRole(..., ROLES.MEMBER)`
   even when `MEMBER` is the lowest possible bar anyway.
5. **`POST /api/execution/plan` (propose a plan) has no `requireRole` call either** — same shape as
   Presence. In practice this doesn't lower the real bar (approval, not proposal, is where role
   severity actually matters — see §11), but it means "propose an action" is not explicitly
   role-gated code, only implicitly gated by organization membership.
6. **`POST /api/execution/[id]/reject` has no `requireRole` call and no rate limit**, asymmetric with
   `/approve`'s `requireRole(MEMBER)` floor + dynamic role check + 20 req/60s limit.
7. **Comment resolve/unresolve is open to any org member**, not restricted to the comment's author or
   to moderators — unlike edit (author-only) and delete (author-or-admin) on the same model.
8. **Bond conversation `'manage'` actions have no ownership-transfer/admin-delegation path** — only the
   original creator or a live org ADMIN+ can ever manage a conversation; there's no way to reassign
   ownership if the creator leaves the organization (their user row cascading away would still leave
   `createdById` pointing at a deleted row per the schema's `onDelete` behavior on that relation, at
   which point `assertConversationAccess`'s `if (!conversation.createdBy) return;` early-return grants
   *everyone* access — worth flagging as a real edge case in the ownership model, not independently
   re-verified against a live deletion in this pass).
9. **Team Space membership is never itself a visibility gate** — see
   [Organization Isolation § Team Spaces](./organization-isolation.md#team-spaces-curation-not-isolation).
   A non-member of a Space can still see everything linked into it, because linking never changes the
   linked resource's own (role-based, org-wide) read gate.

## See also

- [Authorization](./authorization.md) — the `requireRole`/`roleSatisfies` mechanism, the two
  request-gating patterns, CSRF, and resource-level (ownership) checks in full detail.
- [Organization Isolation](./organization-isolation.md) — how `organizationId` is resolved and scoped;
  Team Spaces' curation-not-isolation model.
- [Authentication](./authentication.md) — the session `requireRole` builds on.
- [Audit](./audit.md) — what's recorded when a gated action succeeds.
- [Workflows › Approvals](../workflows/approvals.md) — the dynamic `requiredRole` computation for
  Execution & Approvals in full.
- [`../api/organizations.md`](../api/organizations.md), [`../api/company-data.md`](../api/company-data.md),
  [`../api/collaboration.md`](../api/collaboration.md), [`../api/workflows.md`](../api/workflows.md),
  [`../api/agents.md`](../api/agents.md) — endpoint-level references for the feature areas tabulated
  above.
- [`../database/schema.md`](../database/schema.md) — the `Role` enum and `Membership` model.
