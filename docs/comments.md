# Comments & Mentions (Phase 9)

## Scope

`apps/web/features/comments/` — universal comments attachable to Projects, Tasks, Meetings, Documents,
Customers, and Graph nodes, plus `@user`/`@team`/`@agent` mentions parsed from comment content. This doc
covers the polymorphic `Comment` model, why `entityType`/`entityId` are loosely typed, how mentions are
parsed and validated, and the deliberate cleanup/coverage gaps.

## `entityType`/`entityId`: the `Embedding` precedent, not the `Attachment` one

`Comment.entityType`/`entityId` have **no hard FK** — matching `Embedding.sourceType`/`sourceId`'s own
precedent for "one table spanning genuinely unrelated source tables can't use a normal Prisma relation,"
not `Attachment`/`TimelineEvent`'s `entityId` (a real FK to a single target, `Entity`). `GRAPH_NODE`
covers `Entity` rows including `entityType = NOTE`.

Because there's no hard FK, `comment.service.ts`'s `assertEntityExists` is the app-level check that
stands in for one — it dispatches to the right per-domain lookup (`getTaskById`, `getProjectById`,
`getMeetingById`, `getDocumentById`, `getCustomerById`, `getEntityNode`) and throws `NotFoundError` if
the target doesn't exist in the caller's own organization. This is what prevents a comment from ever
being created against an entity id that belongs to a different organization.

## Mentions: a structured token, not free-text name matching

```
@[Jane Doe](user:clxyz123abc)
@[Engineering](space:clyyy456)
@[Finance Agent](agent:finance)
```

`apps/web/features/comments/lib/mention-parser.ts` extracts mentions with a plain regex over this
structured token — not an NLP step, and not fuzzy-matching a raw `@Jane Doe` against the user directory.
The client's `@`-autocomplete is what resolves "who" and encodes the id directly into the token; the
parser only extracts what's already resolved. Every extracted id is still re-validated server-side
before anything is persisted:

- `@user` ids via `areAllUsersInOrganization` (same helper `Task`/`Project`/`Meeting` assignee validation
  already uses).
- `@space` ids via `areAllSpacesInOrganization` (docs/spaces.md) — Spaces ARE this codebase's "team"
  concept for mentions, introduced in this same phase specifically to serve that role.
- `@agent` keys via the Agent Registry (`getAgentRegistryService().get(agentKey)`, dynamically imported —
  `agents/registry.ts` is a "bootstrap file that imports every concrete implementation," the same shape
  as the Tool Registry, so this stays consistent with that defensive pattern even without a proven cycle
  today).

A comment carrying an unresolvable or out-of-organization mention target is rejected outright
(`ValidationError`), not silently dropped — the author finds out immediately, not after the fact.

**`@agent` mentions are notification-only** in the sense that matters most: they never invoke that agent
to think, respond, or act. Nothing in the spec asks for live agent auto-response to a mention, and Phase
7's "no unapproved autonomous execution" default holds here. Concretely, an `@agent` mention is recorded
as a `Mention` row (visible in-thread, same as any other mention) but does **not** currently fan out a
`Notification` — unlike `@user` mentions, `notifyFromEvent`'s `comment.created` case only reads
`mentionedUserIds` from the event payload. Agents aren't `User` rows and have no inbox of their own to
notify, and routing to "whoever manages this agent" has no single unambiguous recipient today (an agent
can be linked into zero, one, or several Spaces via `SpaceAgent`) — so this is left as recorded-but-silent
rather than guessing a recipient.

## Fan-out: `comment.created` → `notifyFromEvent`

Comment creation publishes a curated `comment.created` Event (`source: COLLABORATION`,
`entityType`/`entityId` set to the commented-on entity) carrying `mentionedUserIds` directly in its
payload. `notifyFromEvent` (docs/notifications.md) reads that array and fans out `MENTION` notifications
straight to those users — bypassing the generic per-`eventType` recipient-resolution table entirely,
since a mention's target is already explicit. A comment with no mentions produces no notification; there
is no generic "someone commented on your task" notification in this phase, only mention-triggered ones.

## Deletion cleanup — and where it's deliberately incomplete

`deleteCommentsForEntity(organizationId, entityType, entityId)` is wired additively into the delete
services for Task, Project, Meeting, Document, and Customer — hard-deleting one of those five now also
removes every comment (and reply, and attachment row) attached to it. This is real cleanup, unlike
`Embedding`'s own unaddressed orphan gap (neither `deleteMeetingService` nor
`deleteKnowledgeDocumentService` cleans up embeddings on hard-delete today) — a dangling comment thread
reachable from a stale notification link is far more user-visible than an orphaned embedding row.

**`GRAPH_NODE` (Entity) is the one exception**, and deliberately so: there is no `deleteEntity`-calling
service anywhere in this codebase as of Phase 9 — the repository function exists
(`packages/database/src/repositories/entities.ts`) but nothing in `apps/web` calls it. There is no
"delete an Entity" user-facing flow to wire cleanup into. If one is built later, wiring
`deleteCommentsForEntity(organizationId, 'GRAPH_NODE', id)` into it is a one-line addition, exactly like
the other five.

## What this does NOT do

- **No live agent auto-response to `@agent` mentions.** Notification-only, as above.
- **No comment editing history.** Unlike Document/Project/Meeting (docs/collaboration.md's Shared
  Editing section), `Comment` has no `version`/`EntityVersionSnapshot` — an edited comment simply
  overwrites `content`; there's no "show me the previous wording."
- **No cross-organization comments.** `Comment.organizationId` is always the caller's own organization,
  the same way every other org-scoped write in this codebase works.
- **No per-attachment removal.** `deleteCommentAttachment` exists in the repository layer but isn't
  wired to any service or route — an attachment can only be removed by deleting the whole comment it's
  on (which cascades). A found-not-fixed gap from the Phase 9 security review, tracked here rather than
  silently left unexplained.
- **No storage cleanup on delete**, matching a pre-existing gap this codebase already has for Documents
  (`deleteDocumentService` doesn't call `deletePublicFile` either) — deleting a comment removes its
  `CommentAttachment` rows via cascade, but the underlying file stays in the Supabase bucket. Not a
  Phase-9-introduced regression; consistent with existing behavior, not fixed here to avoid diverging
  from it in one place while leaving it everywhere else.
