# Bond & Conversations API

API reference for `/api/bond/chat` (the RAG Pipeline's SSE entry point) and `/api/bond/conversations/**`
(chat thread CRUD, message history, Phase 9 Shared AI Sessions sharing/transfer, and archival). "No
shortcuts. Never bypass retrieval." — every turn through `/api/bond/chat` runs through the same
Context Builder documented in [AI & Retrieval API](./ai.md); there is no second, plainer
create-message endpoint anywhere in this surface that could bypass it. See
[Multi-Agent Architecture](../multi-agent.md) for how `POST /api/agents/chat` (a structurally
similar but distinct pipeline — see [Agents API](./agents.md)) differs from this one, and
[Shared AI Sessions](../shared-ai.md) for the Phase 9 sharing model.

**9 route files, 13 endpoints** (`GET`/`POST` both live under `/api/bond/conversations` and under
`/api/bond/conversations/[id]/shares`, and `GET`/`PATCH`/`DELETE` all live under
`/api/bond/conversations/[id]`, so those 3 files contribute more than 1 endpoint each).

## Conventions

Same envelope, pagination, and error-mapping conventions as
[Tools & Execution API](./tools.md#conventions) apply to every route **except**
`POST /api/bond/chat`, which streams SSE instead of a JSON envelope — see its own section below.
Specific to this surface:

- Every mutating route calls `assertSameOrigin(request)`.
- **Auth floor**: `requireActiveOrganizationId()`, then every service function re-checks
  `requireRole(organizationId, ROLES.MEMBER)` — except `POST /api/bond/conversations/archive`,
  which is `ROLES.ADMIN`-gated (a bulk, org-wide action).
- **`POST /api/bond/chat` is rate-limited at 20 requests/60s** — the same limit
  `POST /api/agents/chat` uses, and the tightest limit in this codebase, since a single turn can
  involve several LLM round-trips (planning, tool calls, the final stream). Every other route in
  this file is unlimited.
- **Default-private conversations (Phase 9)**: a `Conversation` with a recorded `createdById` is
  only accessible to its owner, an org `ADMIN`+, or someone it's been explicitly shared with (see
  `assertConversationAccess` below). A conversation with **no** recorded owner (legacy/system rows
  predating this check) is left unrestricted — there is no owner to gate against.
- **No automated tests exist for this surface** — see [Tools & Execution API](./tools.md#conventions).

### The `ConversationAccessLevel` gate

Every route that touches an existing conversation (all of `/api/bond/conversations/[id]/**` except
create/list) calls `assertConversationAccess(conversation, callerId, callerRole, level)`
(`apps/web/features/bond/services/conversation.service.ts:57`) with one of three levels:

| Level | Grants | Who satisfies it |
|---|---|---|
| `'read'` | View the conversation/messages | Owner, org `ADMIN`+, or **any** active share |
| `'collaborate'` | Post new messages (via `/api/bond/chat`) | Owner, org `ADMIN`+, or a share with `permission: 'COLLABORATE'` specifically — a `'READ'` share cannot write |
| `'manage'` | Rename/pin/archive/delete/share/transfer | Owner or org `ADMIN`+ only — **no share ever grants this**, since sharing is about content access, not conversation lifecycle |

This access model did not always exist: before Phase 9, any org `MEMBER` could already
read/rename/delete any other member's conversation by id — this is a real, intentional behavior
change, not a bug fix for a prior regression.

---

## `POST /api/bond/chat` — Send a Message (SSE)

**Method / Path**: `POST /api/bond/chat`
**File**: `apps/web/app/api/bond/chat/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()` → `requireActiveOrganizationId()`; the pipeline
itself re-checks `requireRole(organizationId, ROLES.MEMBER)`
(`apps/web/features/bond/services/rag-pipeline.service.ts:112`).
**Rate limit**: 20 requests / 60 seconds.

The RAG Pipeline's only entry point: User Question → Query Rewrite → Hybrid Search → Knowledge
Graph Expansion → Context Builder → Prompt Builder → LLM → Streaming Response → Citations. Every
branch runs through `buildContext()` (the exact primitive `GET /api/retrieval/context` exposes
directly — see [AI & Retrieval API](./ai.md)) before any generation call; there is no code path
that reaches the AI provider without first assembling context from it.

### Body — `sendBondMessageSchema`

```ts
{
  conversationId?: string; // omit to start a new conversation
  content: string;          // 1-8000 chars, trimmed, required
  model?: string;            // per-message override (Model Selector); falls back to the org's OrganizationAiSettings, then the env default
}
```

### Example request

```json
{ "content": "What's the status of the Q3 Onboarding Revamp project?" }
```

### Response — SSE stream (`Content-Type: text/event-stream`)

Each event is `data: <json>\n\n`, never the `{success,data}` envelope. Event union
(`apps/web/features/bond/lib/stream-events.ts`):

```ts
type BondStreamEvent =
  | { type: 'status'; stage: 'retrieving' | 'planning' | 'tool_call' | 'generating'; detail?: Record<string, unknown> }
  | { type: 'token'; text: string }
  | { type: 'citations'; citations: BondCitation[] }
  | { type: 'suggestions'; questions: string[] }
  | { type: 'done'; conversationId: string; messageId: string; model: string; tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'action_proposed'; conversationId: string; messageId: string; planId: string; summary: string; steps: Array<{ key: string; toolKey: string; displayName: string; summary: string }>; requiredRole: string; estimatedTimeMs: number; rollbackStrategy: string; expiresAt: string }
  | { type: 'error'; message: string };
```

**Event sequence, and exactly when each fires:**

| Order | Event | Fires when |
|---|---|---|
| 1 | `status: retrieving` | Always, immediately after the user's message is persisted. |
| 2 | `status: planning` (repeatable) | Once per planning iteration, only if `BOND_MAX_TOOL_CALLS > 0` — before each LLM call that decides whether to call a read-tool, propose a write, or answer directly. |
| 2a | `status: tool_call` | Only if the model's planning response names a **read** tool — the tool executes, its result is folded back into the prompt, and the loop returns to another `planning` event (up to `BOND_MAX_TOOL_CALLS` iterations). |
| 2b | `action_proposed` **(terminal)** | Only if the model's planning response contains a **write** action marker — a plan is proposed via the same `proposeAction()` chain `POST /api/execution/plan` uses (see [Tools & Execution API](./tools.md)), an `ASSISTANT` message describing the plan is persisted, and **the turn ends here**: no `status: generating`, `token`, `citations`, `suggestions`, or `done` follow in this request. |
| 3 | `status: generating` | Once, only on turns that reach final generation (i.e. did **not** end in `action_proposed`). |
| 4 | `token` (repeatable) | Once per streamed chunk from the provider, in order, concatenating to the final answer. |
| 5 | `citations` | Once, after generation completes — citations validated against real retrieved data, never trusted from raw LLM output. |
| 6 | `suggestions` | Once — 0 or more deterministically-generated follow-up questions derived from the assembled context. |
| 7 | `done` **(terminal)** | Once — the assistant `Message` has been persisted; carries the real `conversationId`/`messageId`/`model`/`tokenUsage` for this turn. |
| — | `error` **(terminal, in-stream only)** | Only if something throws *after* the first successful event (e.g. the provider returns an empty response, a downstream call fails mid-stream). |

Typical Q&A turn:

```
data: {"type":"status","stage":"retrieving"}

data: {"type":"status","stage":"generating"}

data: {"type":"token","text":"The Q3 Onboarding Revamp "}
data: {"type":"token","text":"project is currently ACTIVE, on track for its Sep 30 due date."}

data: {"type":"citations","citations":[{"ref":"proj:proj_11ee...","documentId":null,"documentTitle":null,"page":null,"chunkId":null,"entityId":null,"entityTitle":null,"confidence":0.72}]}

data: {"type":"suggestions","questions":["Who is the project owner?","What tasks are still open?"]}

data: {"type":"done","conversationId":"conv_44d1...","messageId":"msg_c02a...","model":"claude-sonnet-4-5","tokenUsage":{"promptTokens":812,"completionTokens":94,"totalTokens":906}}
```

A turn that proposes a write ends in `action_proposed` instead of steps 3-7 — the exact same plan
shape `POST /api/execution/plan` returns (see [Tools & Execution API](./tools.md)):

```
data: {"type":"status","stage":"planning","detail":{"attempt":1}}

data: {"type":"action_proposed","conversationId":"conv_44d1...","messageId":"msg_d3f0...","planId":"plan_9a1b...","summary":"Create task \"Follow up on onboarding docs\"","steps":[{"key":"step_1","toolKey":"create_task","displayName":"Create Task","summary":"Create task \"Follow up on onboarding docs\""}],"requiredRole":"MEMBER","estimatedTimeMs":1200,"rollbackStrategy":"AUTOMATIC","expiresAt":"2026-07-20T14:32:00.000Z"}
```

**Pre-stream vs. in-stream errors**: auth, CSRF, validation, and not-found errors thrown *before*
the first event still return as a normal `{success:false,...}` JSON response — the route primes the
generator with one `await generator.next()` inside `apiHandler`'s own try/catch before ever calling
`createSseStream`. Only a failure *after* the first successful event becomes a terminal
`{"type":"error",...}` SSE event, since the HTTP status can no longer change once bytes are
flowing. This is the identical split `POST /api/agents/chat` and `POST /api/execution/[id]/approve`
use (see [Agents API](./agents.md) and [Tools & Execution API](./tools.md)).

### Errors (pre-stream)

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or not a member. |
| 404 | `NOT_FOUND` | `conversationId` supplied but doesn't exist in this org, or the organization itself doesn't resolve. |
| 422 | `VALIDATION_ERROR` | Empty/over-length `content`, or (in-stream, surfaced as an SSE `error` event) the AI provider returned an empty response. |
| 429 | `RATE_LIMITED` | More than 20 turns in 60s from this client. |

### Notes

- `assertConversationAccess(..., 'collaborate')` is checked when `conversationId` is supplied — a
  `'READ'`-only share cannot post messages into a shared conversation, only view it.
- Starting a new conversation (`conversationId` omitted) titles it from the first 80 characters of
  `content` — there is no separate "rename on first message" step.
- History passed to the prompt is the 10 most recent messages
  (`getRecentConversationHistory`) plus deterministic "memory facts" — never the full thread, no
  matter how long the conversation has grown.
- `BOND_MAX_TOOL_CALLS` (env var) bounds the planning loop — if the loop runs out without a final
  answer or proposed action, a system notice (`NO_MORE_TOOLS_NOTICE`) is appended and the pipeline
  proceeds straight to final generation.

---

## `GET /api/bond/conversations` — List My Conversations

**Method / Path**: `GET /api/bond/conversations`
**File**: `apps/web/app/api/bond/conversations/route.ts`
**Auth**: `requireAuth()` → `requireRole(organizationId, ROLES.MEMBER)` (inside the service).

**Scoped to the caller's own conversations** — the query always filters `createdById: userId`;
there is no "list every org member's conversations" mode on this endpoint (an `ADMIN`'s elevated
access is per-conversation via `assertConversationAccess`, not a bulk list).

### Query params — `conversationQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `page`, `pageSize`, `search`, `sortDir` | — | — | shared pagination fields |
| `archived` | boolean | — | optional filter |

### Response — `200`

`data: PaginatedResult<ConversationListItem>`, sorted pinned-first then most-recently-updated:

```ts
interface ConversationListItem {
  id: string; title: string | null; pinned: boolean; archived: boolean;
  createdBy: UserSummary | null; messageCount: number; lastMessageAt: string | null;
  createdAt: string; updatedAt: string;
}
```

```json
{
  "success": true,
  "data": {
    "items": [ { "id": "conv_44d1...", "title": "Q3 Onboarding Revamp", "pinned": false, "archived": false, "createdBy": { "id": "user_88ee...", "name": "Priya Salgotra", "email": "priya@acme.com", "avatar": null }, "messageCount": 4, "lastMessageAt": "2026-07-20T14:00:05.000Z", "createdAt": "2026-07-20T13:58:00.000Z", "updatedAt": "2026-07-20T14:00:05.000Z" } ],
    "page": 1, "pageSize": 20, "total": 1, "totalPages": 1
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 422 | `VALIDATION_ERROR` | Invalid `page`/`pageSize`. |

---

## `POST /api/bond/conversations` — Create Conversation

**Method / Path**: `POST /api/bond/conversations`
**File**: `apps/web/app/api/bond/conversations/route.ts`
**Auth**: `assertSameOrigin` → `requireAuth()` → `requireRole(organizationId, ROLES.MEMBER)`.

Not the typical way a conversation gets created — `POST /api/bond/chat` creates one implicitly when
`conversationId` is omitted. This route exists for explicitly starting an empty thread (e.g. an
empty-state "New Chat" button) before the first message is sent.

### Body — `createConversationSchema`

```ts
{ title?: string | null } // max 200
```

### Response — `201`

`data: ConversationListItem`, with `messageCount: 0`, `lastMessageAt: null`, `createdBy: null` —
the response is synthesized directly by the service rather than re-fetched, so `createdBy` doesn't
resolve the caller's own `UserSummary` in this response (unlike every other route in this file).

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or not a member. |
| 422 | `VALIDATION_ERROR` | Over-length `title`. |

---

## `GET /api/bond/conversations/[id]` — Get One Conversation

**Method / Path**: `GET /api/bond/conversations/{id}`
**File**: `apps/web/app/api/bond/conversations/[id]/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)` → `assertConversationAccess(..., 'read')`.

### Response — `200`

`data: ConversationListItem`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Not a member; or a member but neither the owner, `ADMIN`+, nor holder of any active share ("You do not have access to this conversation."). |
| 404 | `NOT_FOUND` | No `Conversation` with this `id` in this organization. |

---

## `PATCH /api/bond/conversations/[id]` — Rename / Pin / Archive

**Method / Path**: `PATCH /api/bond/conversations/{id}`
**File**: `apps/web/app/api/bond/conversations/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)` →
`assertConversationAccess(..., 'manage')`.

### Body — `updateConversationSchema`

```ts
{ title?: string | null; pinned?: boolean; archived?: boolean } // title: max 200
```

### Response — `200`

`data: ConversationListItem`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`; not a member; **or** a share-only viewer/collaborator ("Only the conversation owner can manage this conversation.") — `manage` grants no share, ever. |
| 404 | `NOT_FOUND` | No `Conversation` with this `id`. |
| 422 | `VALIDATION_ERROR` | Over-length `title`. |

---

## `DELETE /api/bond/conversations/[id]` — Delete Conversation

**Method / Path**: `DELETE /api/bond/conversations/{id}`
**File**: `apps/web/app/api/bond/conversations/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)` →
`assertConversationAccess(..., 'manage')`.

### Response — `200`

`data: null` — the one delete route in this file that doesn't echo back `{ id }`.

### Errors

Same auth pattern as `PATCH` above.

---

## `GET /api/bond/conversations/[id]/messages` — List Messages

**Method / Path**: `GET /api/bond/conversations/{id}/messages`
**File**: `apps/web/app/api/bond/conversations/[id]/messages/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)` → `assertConversationAccess(..., 'read')`.

**Read-only, deliberately** — sending a message only ever happens through `POST /api/bond/chat`'s
SSE pipeline; there is no plain `POST` on this route, so no second write path can bypass retrieval.

### Path params

| Param | Meaning |
|---|---|
| `id` | `Conversation.id` |

### Query params — `messageQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `page` | number | `1` | |
| `pageSize` | number | `50` | max `100` — the one list endpoint in this codebase whose default `pageSize` isn't 20 |

### Response — `200`

`data: PaginatedResult<MessageItem>`, **oldest-first** (chat reading order — unlike every other
paginated list in this codebase, which is newest-first):

```ts
interface MessageItem {
  id: string; conversationId: string; role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string; citations: unknown; metadata: unknown; tokenUsage: unknown;
  model: string | null; user: UserSummary | null; createdAt: string;
}
```

```json
{
  "success": true,
  "data": {
    "items": [
      { "id": "msg_a1", "conversationId": "conv_44d1...", "role": "USER", "content": "What's the status of the Q3 Onboarding Revamp project?", "citations": null, "metadata": null, "tokenUsage": null, "model": null, "user": { "id": "user_88ee...", "name": "Priya Salgotra", "email": "priya@acme.com", "avatar": null }, "createdAt": "2026-07-20T13:58:00.000Z" },
      { "id": "msg_c02a...", "conversationId": "conv_44d1...", "role": "ASSISTANT", "content": "The Q3 Onboarding Revamp project is currently ACTIVE...", "citations": [ { "ref": "proj:proj_11ee...", "confidence": 0.72 } ], "metadata": { "toolCallsUsed": 0, "durationMs": 2140 }, "tokenUsage": { "promptTokens": 812, "completionTokens": 94, "totalTokens": 906 }, "model": "claude-sonnet-4-5", "user": null, "createdAt": "2026-07-20T13:58:02.000Z" }
    ],
    "page": 1, "pageSize": 50, "total": 2, "totalPages": 1
  }
}
```

`citations`/`metadata`/`tokenUsage` are raw JSON columns — shape varies by row (a `USER` message
has none of them; an `ASSISTANT` message that proposed a write carries `metadata.planId`/`status`
instead of `tokenUsage`). `user` is only set on `USER`-role rows.

### Errors

Same as `GET /api/bond/conversations/[id]`.

---

## `GET /api/bond/conversations/[id]/shares` — List Shares

**Method / Path**: `GET /api/bond/conversations/{id}/shares`
**File**: `apps/web/app/api/bond/conversations/[id]/shares/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)` → `assertConversationAccess(..., 'manage')`.

Who this conversation is currently shared with — a `'manage'`-level read (only the owner/`ADMIN`+
can see the share list, matching who can create one).

### Response — `200`

```ts
interface ConversationShareData {
  id: string; organizationId: string; conversationId: string; sharedWithUserId: string;
  sharedWith: UserSummary; permission: 'READ' | 'COLLABORATE'; sharedBy: UserSummary | null; createdAt: string;
}
```

### Errors

Same auth pattern as `PATCH /api/bond/conversations/[id]`.

---

## `POST /api/bond/conversations/[id]/shares` — Share Conversation

**Method / Path**: `POST /api/bond/conversations/{id}/shares`
**File**: `apps/web/app/api/bond/conversations/[id]/shares/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)` →
`assertConversationAccess(..., 'manage')`.

**Upserted** on the `(conversationId, sharedWithUserId)` unique constraint — re-sharing with the
same person updates their permission rather than erroring or duplicating. Always to a specific org
member — never public, never cross-organization.

### Body — `shareConversationSchema`

```ts
{ sharedWithUserId: string; permission: 'READ' | 'COLLABORATE' }
```

### Example request

```json
{ "sharedWithUserId": "user_cd12...", "permission": "COLLABORATE" }
```

### Response — `201`

`data: ConversationShareData`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`; not a member; or caller lacks `manage` access. |
| 404 | `NOT_FOUND` | No `Conversation` with this `id`. |
| 422 | `VALIDATION_ERROR` | `sharedWithUserId` is already the conversation's owner ("This conversation is already owned by that user."), or `sharedWithUserId` isn't a member of this organization. |

---

## `DELETE /api/bond/conversations/[id]/shares/[userId]` — Revoke Share

**Method / Path**: `DELETE /api/bond/conversations/{id}/shares/{userId}`
**File**: `apps/web/app/api/bond/conversations/[id]/shares/[userId]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)` →
`assertConversationAccess(..., 'manage')`.

### Path params

| Param | Meaning |
|---|---|
| `id` | `Conversation.id` |
| `userId` | The shared-with user's `User.id` |

### Response — `200`

```json
{ "success": true, "data": { "removed": true } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`; not a member; or caller lacks `manage` access. |
| 404 | `NOT_FOUND` | No `Conversation` with this `id`, **or** this conversation isn't currently shared with `userId` ("This conversation is not shared with that user."). |

---

## `POST /api/bond/conversations/[id]/transfer` — Transfer Ownership

**Method / Path**: `POST /api/bond/conversations/{id}/transfer`
**File**: `apps/web/app/api/bond/conversations/[id]/transfer/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)` →
`assertConversationAccess(..., 'manage')`.

Reassigns `Conversation.createdById` — the **only** way a non-owner can ever gain `manage` access
to a conversation, since no share level grants it. Kept as its own dedicated endpoint rather than
folded into the generic `PATCH`, since reassigning ownership is a distinct, security-sensitive
operation.

### Body — `transferConversationOwnershipSchema`

```ts
{ newOwnerId: string }
```

### Response — `200`

`data: ConversationListItem` (re-fetched, reflecting the new `createdBy`).

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`; not a member; or caller lacks `manage` access. |
| 404 | `NOT_FOUND` | No `Conversation` with this `id`. |
| 422 | `VALIDATION_ERROR` | `newOwnerId` isn't a member of this organization. |

---

## `POST /api/bond/conversations/archive` — Archive Old Conversations (Bulk)

**Method / Path**: `POST /api/bond/conversations/archive`
**File**: `apps/web/app/api/bond/conversations/archive/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`. **The only `ADMIN`-gated
route in this file** — every other mutating route here tops out at `MEMBER` (gated further by
per-conversation `manage` access, not org role).

The manual "Archive old conversations" admin action (spec's memory-expiration requirement) — flags
every non-archived conversation in the org older than the cutoff. **No background worker runs
this** — it only ever executes when explicitly called, the same "no scheduler" posture documented
throughout this codebase (see [Workflows API](./workflows.md#conventions)).

### Body — `archiveConversationsSchema`

```ts
{ olderThanDays?: number } // positive, max 3650; defaults to the MEMORY_RETENTION_DAYS env var if omitted
```

### Example request

```json
{ "olderThanDays": 90 }
```

### Response — `200`

```json
{ "success": true, "data": { "archivedCount": 14 } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 422 | `VALIDATION_ERROR` | `olderThanDays` out of range. |

### Notes

- This is org-wide — it archives every eligible conversation regardless of owner, unlike every
  other route in this file, which is scoped by conversation ownership/sharing.

---

## `GET /api/bond/conversations/shared-with-me` — Conversations Shared With Me

**Method / Path**: `GET /api/bond/conversations/shared-with-me`
**File**: `apps/web/app/api/bond/conversations/shared-with-me/route.ts`
**Auth**: `requireAuth()` → `requireRole(organizationId, ROLES.MEMBER)`.

Every conversation shared *with* the caller, across the organization, most-recently-shared first —
the "Shared Conversations" UI's data source. Uses the shared `paginationQuerySchema` directly
(`.pick({ page: true, pageSize: true })`), not a dedicated schema.

### Query params

| Field | Type | Default |
|---|---|---|
| `page` | number | `1` |
| `pageSize` | number | `20`, max `100` |

### Response — `200`

`data: PaginatedResult<SharedConversationSummary>`:

```ts
interface SharedConversationSummary {
  share: ConversationShareData; // see the /shares section above
  conversation: { id: string; title: string | null; createdBy: UserSummary | null; updatedAt: string };
}
```

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "share": { "id": "share_1a2b...", "organizationId": "org_1a2b...", "conversationId": "conv_44d1...", "sharedWithUserId": "user_cd12...", "sharedWith": { "id": "user_cd12...", "name": "Sam Rivera", "email": "sam@acme.com", "avatar": null }, "permission": "COLLABORATE", "sharedBy": { "id": "user_88ee...", "name": "Priya Salgotra", "email": "priya@acme.com", "avatar": null }, "createdAt": "2026-07-20T14:10:00.000Z" },
        "conversation": { "id": "conv_44d1...", "title": "Q3 Onboarding Revamp", "createdBy": { "id": "user_88ee...", "name": "Priya Salgotra", "email": "priya@acme.com", "avatar": null }, "updatedAt": "2026-07-20T14:00:05.000Z" }
      }
    ],
    "page": 1, "pageSize": 20, "total": 1, "totalPages": 1
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 422 | `VALIDATION_ERROR` | Invalid `page`/`pageSize`. |

## Related docs

- [Agents API](./agents.md) — `POST /api/agents/chat`, the structurally similar multi-agent
  pipeline this codebase keeps as a distinct implementation (not a thin wrapper over this file's
  chat route), plus the same pre-stream/in-stream error split and 20/60s rate limit.
- [AI & Retrieval API](./ai.md) — `buildContext()`, the exact retrieval primitive
  `POST /api/bond/chat` calls, also directly previewable via `GET /api/retrieval/context`; and
  `GET /api/ai/cost`, which sums the `tokenUsage` every `done` event/persisted `Message` carries.
- [Tools & Execution API](./tools.md) — the `proposeAction()` chain `action_proposed` events
  originate from, and the approval flow that follows.
- [Organizations API](./organizations.md) — membership, the source of every `UserSummary` and the
  pool `shareConversationSchema`/`transferConversationOwnershipSchema` validate `sharedWithUserId`/
  `newOwnerId` against.
