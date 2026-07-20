# Conversations (Phase 5 "Mr. Bond")

## Scope

The Conversation CRUD surface — spec §9's chat thread list: list/create/rename/pin/archive/delete,
plus the "Archive old conversations" manual admin action.
`apps/web/features/bond/services/conversation.service.ts` and its routes under
`apps/web/app/api/bond/conversations/**`. This doc does **not** cover how a message gets created —
that happens exclusively inside the RAG pipeline (`rag-pipeline.service.ts`, `/api/bond/chat`'s SSE
stream); see docs/citations.md and docs/memory.md for the two pieces of that pipeline this phase
also adds. Nothing here calls an AI provider — it's Prisma reads/writes behind `requireRole`, same
shape as every other CRUD service in the codebase.

## Data model

```prisma
model Conversation {
  id             String   @id @default(cuid())
  organizationId String
  createdById    String?
  title          String?
  pinned         Boolean  @default(false)
  archived       Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy    User?        @relation("ConversationCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  messages     Message[]

  @@index([organizationId])
  @@index([organizationId, pinned])
  @@index([organizationId, archived])
  @@map("conversations")
}
```

`Message.conversationId` has no explicit `onDelete` override beyond Prisma's relation default of
`Cascade` on `Conversation`, so deleting a conversation removes its messages with it — there is no
separate "delete messages first" step anywhere in `deleteConversationService`.

`Message` also carries `organizationId` denormalized directly onto the row (not just reachable via
`conversationId`) — the schema comment explains why: "matching Entity/Relationship/TimelineEvent/
Embedding's own convention, so cost/observability aggregation never needs a join." That's what lets
`archiveConversationsOlderThan` and every service below filter by `organizationId` without a join
back through `Conversation`.

## The CRUD surface

Every exported function takes `organizationId` first and calls `requireRole(organizationId,
ROLES.MEMBER)` itself, the same convention documented in docs/memory.md and docs/graph-api.md:

```ts
export async function listConversationsService(
  organizationId: string,
  userId: string,
  query: ConversationQuery,
): Promise<PaginatedResult<ConversationListItem>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listConversations({ organizationId, userId, ...query });
}

export async function getConversationService(organizationId: string, id: string): Promise<ConversationListItem> {
  await requireRole(organizationId, ROLES.MEMBER);
  const conversation = await getConversationById(id, organizationId);
  if (!conversation) throw new NotFoundError('Conversation not found.');
  return conversation;
}

export async function createConversationService(
  organizationId: string,
  userId: string,
  input: CreateConversationInput,
): Promise<ConversationListItem> {
  await requireRole(organizationId, ROLES.MEMBER);
  const created = await createConversationRow({ organizationId, createdById: userId, title: input.title });
  return { ...created, createdBy: null, messageCount: 0, lastMessageAt: null };
}

export async function updateConversationService(
  organizationId: string,
  id: string,
  input: UpdateConversationInput,
): Promise<ConversationListItem> {
  await requireRole(organizationId, ROLES.MEMBER);
  const updated = await updateConversationRow(id, organizationId, input);
  if (!updated) throw new NotFoundError('Conversation not found.');
  return getConversationService(organizationId, id);
}

export async function deleteConversationService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.MEMBER);
  const deleted = await deleteConversationRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Conversation not found.');
}
```

Rename, pin, and archive are not three separate functions — they're all the one `updateConversation`
Prisma call (`packages/database/src/repositories/conversations.ts`), narrowed by
`UpdateConversationData`'s three optional fields:

```ts
export interface UpdateConversationData {
  title?: string | null;
  pinned?: boolean;
  archived?: boolean;
}

export async function updateConversation(
  id: string,
  organizationId: string,
  data: UpdateConversationData,
): Promise<boolean> {
  const result = await prisma.conversation.updateMany({ where: { id, organizationId }, data });
  return result.count > 0;
}
```

The API layer's `updateConversationSchema` (`packages/shared/src/schemas/bond.ts`) accepts the same
three fields, each optional, so a single `PATCH /api/bond/conversations/:id` body can rename, pin,
and archive in one request if a caller wants to — there's no dedicated `/pin` or `/archive`
sub-route, unlike some REST APIs that give each action its own endpoint.

## API surface

`apps/web/app/api/bond/conversations/`:

| Route | Method | Service | Notes |
| --- | --- | --- | --- |
| `/api/bond/conversations` | `GET` | `listConversationsService` | paginated, scoped to the caller |
| `/api/bond/conversations` | `POST` | `createConversationService` | optional `title`, `201` on success |
| `/api/bond/conversations/[id]` | `GET` | `getConversationService` | |
| `/api/bond/conversations/[id]` | `PATCH` | `updateConversationService` | rename / pin / archive, any combination |
| `/api/bond/conversations/[id]` | `DELETE` | `deleteConversationService` | hard delete, cascades to `Message` |
| `/api/bond/conversations/[id]/messages` | `GET` | `listMessagesService` | read-only, see below |
| `/api/bond/conversations/archive` | `POST` | `archiveOldConversationsService` | ADMIN-only, see below |

Every mutating route (`POST`, `PATCH`, `DELETE`) calls `assertSameOrigin(request)` before touching
the database — the same CSRF convention every other mutating route in the app follows.

`GET /api/bond/conversations` always passes the caller's own `user.id` through as `userId`:

```ts
export const GET = apiHandler(async (request) => {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, conversationQuerySchema);
  const result = await listConversationsService(organizationId, user.id, query);
  return apiSuccess(result);
});
```

### Ownership scope

`listConversations`'s own doc comment states the resulting behavior plainly:

```ts
/** `userId`, when passed, scopes to conversations that user created — the conversation list sidebar only ever shows the caller's own threads, never every org member's. */
export async function listConversations(filters: ConversationListFilters): Promise<PaginatedResult<ConversationListItem>> {
```

Because the route always supplies `user.id`, every caller of `GET /api/bond/conversations` sees only
the conversations they themselves created within the active organization — there is no "all
conversations in this org" admin view. `getConversationService`/`getConversationById`, by contrast,
take no `userId` — any org member with `MEMBER` role who has (or guesses) a conversation's id can
open it directly, the same `findFirst({ where: { id, organizationId } })` org-scoping pattern used
everywhere else in the codebase, just not additionally narrowed to the creator.

### Ordering: pinned first, then most recently updated — not caller-controlled

```ts
const [items, total] = await Promise.all([
  prisma.conversation.findMany({
    where,
    orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: listInclude,
  }),
  prisma.conversation.count({ where }),
]);
```

`conversationQuerySchema` extends the shared `paginationQuerySchema`, which includes a `sortDir`
field — but `listConversations` never reads `sortDir` out of its `filters`. The ordering is fixed:
pinned conversations always sort above unpinned ones, and within each group the most recently
touched conversation (`updatedAt`, bumped by `touchConversation` every time a new message is added —
see `rag-pipeline.service.ts`) sorts first. `search` narrows by `title` (case-insensitive `contains`)
and `archived` filters the boolean directly; neither affects ordering.

### Sending messages is deliberately not part of this surface

`GET /api/bond/conversations/[id]/messages` is the only messages route, and it's read-only on
purpose:

```ts
/**
 * Read-only message history for a conversation. Deliberately GET-only —
 * sending a message happens exclusively through the RAG pipeline
 * (`/api/bond/chat`'s SSE stream), never through a plain create-message
 * endpoint, so no second write path can bypass retrieval.
 */
export const GET = apiHandler<Context>(async (request, { params }) => {
```

There is no `POST /api/bond/conversations/[id]/messages` — appending a message without going through
`runBondChatPipeline` (query rewrite → hybrid search → context → citations, see docs/citations.md
and docs/memory.md) would be a message with no retrieval and no citation validation behind it, which
this API surface simply doesn't expose a way to create.

## The "Archive old conversations" manual admin action

```ts
/** The manual "Archive old conversations" admin action (spec §5's memory expiration) — no background worker, same honesty as Phase 2/4's sync/embedding jobs. */
export async function archiveOldConversationsService(organizationId: string, olderThanDays?: number): Promise<number> {
  await requireRole(organizationId, ROLES.ADMIN);
  const days = olderThanDays ?? getEnv().MEMORY_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return archiveConversationsOlderThan(organizationId, cutoff);
}
```

```ts
/** Flags conversations older than `olderThan` as archived — the manual "Archive old conversations" admin action, no background worker. */
export async function archiveConversationsOlderThan(organizationId: string, olderThan: Date): Promise<number> {
  const result = await prisma.conversation.updateMany({
    where: { organizationId, archived: false, updatedAt: { lt: olderThan } },
    data: { archived: true },
  });
  return result.count;
}
```

Three things worth being precise about:

- **It requires `ROLES.ADMIN`**, unlike every other conversation function above (which only require
  `ROLES.MEMBER`) — archiving en masse is an org-level administrative action, not something any
  member can trigger against other members' threads.
- **The cutoff is on `updatedAt`, not `createdAt`.** A long-running conversation that's had a message
  added recently is never swept up by this, no matter how old the conversation itself is — "old"
  here means "not talked to in N days," matching the same `updatedAt` field `touchConversation` bumps
  on every new message.
- **It archives (sets `archived: true`), it never deletes.** This is the same distinction the
  `ConversationList` UI's own archive button and delete button (`Archive` vs. `Trash2`, with a
  confirmation dialog only on delete) make: archiving is reversible via `PATCH { archived: false }`,
  deletion is not.

`MEMORY_RETENTION_DAYS` (`packages/shared/src/env.ts`) is the default window, optional with a
built-in fallback:

```ts
MEMORY_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
```

`archiveConversationsSchema` (`packages/shared/src/schemas/bond.ts`) lets a caller override that
default per-request via `olderThanDays` (1–3650 days):

```ts
export const archiveConversationsSchema = z.object({
  olderThanDays: z.coerce.number().int().positive().max(3650).optional(),
});
```

### No background worker — invoked directly, not on a schedule

This is the same honesty this codebase has already established for "not-yet-automated" admin
actions — Phase 2's Sync Engine (docs/connectors.md: "No background workers... `SCHEDULED`/`WEBHOOK`
triggers are represented... but have no scheduler/webhook-receiver behind them yet") and Phase 4's
`EmbeddingJob` retry path (docs/embeddings.md: "No real background worker/scheduler... Jobs run
synchronously inside the request that triggers them"). `archiveOldConversationsService` follows the
identical pattern:

- There is no cron job, queue consumer, or scheduled task anywhere in this codebase that calls
  `archiveOldConversationsService` on a timer. `MEMORY_RETENTION_DAYS` is a *policy* the app knows
  about (a default cutoff), not a *schedule* — nothing wakes up daily and enforces it.
- `POST /api/bond/conversations/archive` (`apps/web/app/api/bond/conversations/archive/route.ts`) is
  the only caller anywhere in `apps/web`; nothing in `apps/web/features/bond/components/**` renders a
  button or triggers a request to it. It exists today as an ADMIN-gated API action — reachable, real,
  and fully working end to end — waiting for a scheduler or an admin-UI button to call it, exactly
  the same "architecture is real, the trigger isn't wired up automatically yet" state Phase 2/4 left
  their own admin actions in.
- Calling it does real, immediate work synchronously inside the request (one `updateMany`), the same
  way `triggerSyncService` and `rebuildVectorsService` do their work inline rather than handing off to
  a job processor.

## What's deliberately not built

- **No shared/team conversations.** `listConversationsService` always scopes to the calling user's
  own `createdById`; there is no way for one org member to see another member's conversation list
  (only to open one directly by id, since `getConversationService` doesn't filter by creator). Making
  Bond conversations shared/collaborative is a product decision this phase doesn't make.
- **No scheduled archival.** As above — `MEMORY_RETENTION_DAYS` and `archiveOldConversationsService`
  are real, but nothing invokes them automatically. An admin (or a future cron job) has to call the
  endpoint.
- **No soft-delete / trash / undo for `DELETE`.** `deleteConversationService` is a real
  `prisma.conversation.deleteMany`, and the relation cascade takes every `Message` with it. Archiving
  is the reversible action; deletion is not, and there's no recovery path once it succeeds.
- **No per-conversation retention override stored anywhere.** `olderThanDays` on the archive endpoint
  is a per-*call* override, not a per-*conversation* setting — there's no column on `Conversation`
  that says "never archive this one" or "archive this one after 7 days" independent of the org-wide
  default.
- **No dedicated pin/archive sub-routes.** Both are just fields on the one `PATCH` body — see "The
  CRUD surface" above.
