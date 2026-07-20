# Shared AI Sessions (Phase 9)

## Scope

`apps/web/features/bond/services/conversation.service.ts` — the `assertConversationAccess` gate, plus
the sharing and ownership-transfer surface built on top of it, and the `ConversationShare` model
(`packages/database/src/repositories/conversation-shares.ts`). This doc covers the access model this
phase introduces, how sharing and ownership transfer work, and where each is enforced.

## The gap this closes

Before this phase, `Conversation` had no ownership check anywhere. `createdById` was stored on every
row, but every route (`GET`/`PATCH`/`DELETE /api/bond/conversations/[id]`, the messages list, the chat
send path) only ever scoped by `organizationId` — any org MEMBER could already read, rename, archive, or
delete any other member's Bond conversation by id, and could post into it via `/api/bond/chat`. This was
discovered while planning this phase, not assumed; treating "introduce real privacy" as in-scope,
intentional work (not a bug fix for a regression) matters because it's a genuine behavior change a
caller could depend on the old, unrestricted behavior — worth calling out plainly rather than shipping
silently.

## Access levels

```ts
export type ConversationAccessLevel = 'read' | 'collaborate' | 'manage';
```

- **`read`** — view the conversation and its messages. Granted to: the owner (`createdById`), any org
  member with role ADMIN or above, or anyone holding *any* `ConversationShare` on it (READ or
  COLLABORATE).
- **`collaborate`** — post new messages into the conversation via `/api/bond/chat`. Granted to: the
  owner, ADMIN+, or specifically a COLLABORATE-permission share — a READ share cannot post.
- **`manage`** — rename, pin, archive, delete, share, or transfer ownership of the conversation. Granted
  to: the owner or ADMIN+ *only*. No share, regardless of permission, grants this — sharing is about
  content access, not conversation lifecycle. Ownership transfer (below) is the one way a non-owner
  gains `manage`.

```ts
export async function assertConversationAccess(
  conversation: ConversationListItem,
  callerId: string,
  callerRole: Role,
  level: ConversationAccessLevel,
): Promise<void> {
  if (!conversation.createdBy) return; // legacy/system row with no recorded owner — unrestricted
  if (conversation.createdBy.id === callerId) return;
  if (roleSatisfies(callerRole, ROLES.ADMIN)) return;
  if (level === 'manage') throw new ForbiddenError(/* ... */);

  const share = await getConversationShareForUser(conversation.id, callerId);
  if (!share) throw new ForbiddenError(/* ... */);
  if (level === 'collaborate' && share.permission !== 'COLLABORATE') throw new ForbiddenError(/* ... */);
}
```

A conversation with **no recorded `createdBy`** is left unrestricted — there is no owner to gate
against. This only narrows access for conversations that actually have one; it can't turn a
never-had-privacy row into a 403 for everyone.

## Where it's enforced

| Path | Level | File |
|---|---|---|
| `getConversationService` | `read` | `conversation.service.ts` |
| `updateConversationService` (rename/pin/archive) | `manage` | `conversation.service.ts` |
| `deleteConversationService` | `manage` | `conversation.service.ts` |
| `listMessagesService` | `read` | `message.service.ts` |
| `runBondChatPipeline` (posting into an *existing* conversation) | `collaborate` | `rag-pipeline.service.ts` |
| `shareConversationService` / `listConversationSharesService` / `removeConversationShareService` | `manage` | `conversation.service.ts` |
| `transferConversationOwnershipService` | `manage` | `conversation.service.ts` |

Every one of these already called `requireRole(organizationId, ROLES.MEMBER)` before this phase — the
access check is layered on top of that using the `{ session, membership }` it already returns, so no
route signature changed. `requireRole` resolves the caller's identity server-side from their session;
nothing here trusts a client-supplied user id.

## `ConversationShare`

```prisma
model ConversationShare {
  id               String          @id @default(cuid())
  organizationId   String
  conversationId   String
  sharedWithUserId String
  permission       SharePermission // READ | COLLABORATE
  sharedById       String?
  createdAt        DateTime        @default(now())
  @@unique([conversationId, sharedWithUserId])
}
```

Always to a specific org member — there is no public-link or cross-organization sharing mode, matching
this phase's explicit Do-NOT-Build boundary. `upsertConversationShare` re-shares idempotently: sharing
with the same person twice updates their permission rather than erroring or duplicating a row.
`shareConversationService` additionally rejects sharing with the conversation's own owner (a no-op that
would just be confusing) and validates `sharedWithUserId` is actually a member of the caller's
organization via the same `areAllUsersInOrganization` helper Task/Project/Meeting assignee validation
already uses.

`GET/POST /api/bond/conversations/[id]/shares` and `DELETE .../shares/[userId]` are all `manage`-gated —
only the owner or an ADMIN+ can see or change who a conversation is shared with; a COLLABORATE share
does not let its holder re-share the conversation with someone else.

## Ownership transfer

`POST /api/bond/conversations/[id]/transfer` reassigns `Conversation.createdById` via a dedicated
repository function, `transferConversationOwnership` — kept separate from the generic
`updateConversation` field-update path on purpose, since reassigning ownership is a distinct,
security-sensitive operation the generic update should never be able to accidentally trigger. Only the
current owner or an ADMIN+ can transfer ownership, and the new owner must already be a member of the
organization (validated the same way sharing validates its target).

## What this does NOT do

- **No public or cross-organization sharing.** Every share targets one specific member of the same
  organization the conversation belongs to.
- **No citation changes.** Citations are already per-`Message` and untouched by any of this — a shared
  conversation renders identically to its owner's own view; integrity is preserved by construction, not
  new code.
