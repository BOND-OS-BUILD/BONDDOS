# Shared AI Sessions (Phase 9)

## Scope

`apps/web/features/bond/services/conversation.service.ts`'s `assertConversationAccess`, plus the
`ConversationShare` model (`packages/database/src/repositories/conversation-shares.ts`). This doc covers
the access model this phase introduces. Share-creation UI, an explicit `POST /api/collaboration`-family
share-management route, and ownership transfer land alongside the rest of Phase 9's UI surface; this doc
will grow to cover them then. What's below — the access GATE itself — is built and enforced today on
every existing conversation read/write path.

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
- **`manage`** — rename, pin, archive, or delete the conversation. Granted to: the owner or ADMIN+
  *only*. No share, regardless of permission, grants this — sharing is about content access, not
  conversation lifecycle. (Ownership transfer, when it lands, will be the one way a non-owner gains
  `manage`.)

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

## What this does NOT do

- **No public or cross-organization sharing.** Every share targets one specific member of the same
  organization the conversation belongs to.
- **No ownership transfer yet.** The `manage` level exists and is enforced; the service method that
  reassigns `Conversation.createdById` lands with the rest of Phase 9's Shared AI Sessions surface.
- **No citation changes.** Citations are already per-`Message` and untouched by any of this — a shared
  conversation renders identically to its owner's own view; integrity is preserved by construction, not
  new code.
