# Chat (Phase 5)

## Scope

This doc covers the three layers directly underneath the "Mr. Bond" chat surface: the
`Conversation`/`Message` data model (`packages/database/prisma/schema.prisma`'s Phase 5 section),
the SSE streaming transport that carries one chat turn from `POST /api/bond/chat` to the browser
(`apps/web/lib/streaming-handler.ts` + `apps/web/features/bond/lib/stream-events.ts`), and the Chat
UI that renders it (`apps/web/app/(dashboard)/bond/**`, `apps/web/features/bond/components/**`). See
docs/rag.md for the pipeline that actually produces the events this transport carries,
docs/tool-calling.md for the read-only tool loop that runs inside that pipeline, docs/citations.md
for how a citation is validated before it ever reaches `Message.citations`, docs/conversations.md
for the `/api/bond/conversations/**` CRUD surface `ConversationList` calls, and docs/memory.md for
the deterministic memory `conversation-memory.service.ts` builds on. See docs/mr-bond.md for the
phase-level overview and the "Do NOT Build" exclusions all of the above respect.

## Data model: `Conversation` and `Message`

Both models live in schema.prisma's Phase 5 section, whose own header states the phase's one rule
plainly:

```prisma
// ── Phase 5: Mr. Bond AI Copilot ────────────────────────────────────────────
// Read-only RAG chat. Every answer goes through Phase 4's Retrieval Layer
// (hybridSearch/buildContext/buildPrompt/AI provider `stream()`) — no
// autonomous agents, no writes, no multi-agent systems. See docs/mr-bond.md,
// docs/chat.md, docs/rag.md.
```

### `MessageRole`

```prisma
enum MessageRole {
  SYSTEM
  USER
  ASSISTANT
  TOOL
}
```

Four values are declared, but only two are ever written: `createMessage` is called exactly twice in
the whole codebase — once for the incoming `USER` turn, once for the finished `ASSISTANT` turn, both
in `rag-pipeline.service.ts`. No code path anywhere creates a `Message` row with `role: 'SYSTEM'` or
`role: 'TOOL'`; the tool-calling exchange (the planning turns, the tool results) lives only in the
in-memory `messages: ChatMessage[]` array the pipeline builds for that one request and is never
persisted. `SYSTEM`/`TOOL` exist in the enum for a future phase that might want to durably record
that exchange, not because anything reads or writes them today — the `[conversationId]/page.tsx`
server component makes the same assumption explicit when it loads history:

```ts
const initialMessages: BondChatMessage[] = messagesResult.items
  .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
  .map((message) => ({
```

### `Conversation`

```prisma
/// A chat thread. `createdById` nullable (SetNull) so deleting a user doesn't
/// cascade-delete organization conversation history — same "history survives
/// the actor" reasoning as `Relationship.createdBy`/`Folder.createdBy`.
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

A thread's `title` defaults to the first 80 characters of the user's opening message
(`title: input.content.slice(0, 80)` in `rag-pipeline.service.ts`) — there's no separate
title-generation LLM call. `pinned`/`archived` back the sidebar affordances in `ConversationList`;
the two composite indexes (`[organizationId, pinned]`, `[organizationId, archived]`) exist because
the sidebar query filters on exactly those pairs (`listConversations`'s `where` clause).

### `Message`

```prisma
/// `organizationId` is denormalized directly onto Message (not just reachable
/// via conversationId) — matching Entity/Relationship/TimelineEvent/Embedding's
/// own convention, so cost/observability aggregation never needs a join.
/// `userId` is null for ASSISTANT/SYSTEM/TOOL rows (only a USER message has an
/// author). `citations`/`metadata`/`tokenUsage` are Json — citations are
/// re-resolved via resolveCitationService before being persisted here, so a
/// hallucinated ref never lands in this column (see docs/citations.md).
model Message {
  id             String      @id @default(cuid())
  conversationId String
  organizationId String
  userId         String?
  role           MessageRole
  content        String
  citations      Json?
  metadata       Json?
  tokenUsage     Json?
  model          String?
  createdAt      DateTime    @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User?        @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([conversationId, createdAt])
  @@index([organizationId])
  @@map("messages")
}
```

The three `Json?` columns each carry one specific, already-shaped payload from the pipeline, not a
free-form bag: `citations` is the `Citation[]` that survived `validateCitations` (docs/citations.md),
`tokenUsage` is `{ promptTokens, completionTokens, totalTokens }`, and `metadata` is
`{ toolCallsUsed, durationMs }` — see the `createMessage` call at the end of
`rag-pipeline.service.ts` for exactly what's written into each.

Alongside `Conversation`/`Message`, the same schema section adds `OrganizationAiSettings` — one
row per organization, every field nullable so an unset field falls back to the existing
`AI_PROVIDER`/`AI_MODEL`/`AI_TEMPERATURE`/`AI_MAX_TOKENS` env defaults (docs/ai-service.md). It's
what `resolveEffectiveAiConfigService` merges with the per-message `model` override before
`rag-pipeline.service.ts` ever calls a provider; not otherwise covered by this doc.

## Why `organizationId` is denormalized onto `Message`

The schema comment above states the reasoning — "matching Entity/Relationship/TimelineEvent/
Embedding's own convention, so cost/observability aggregation never needs a join" — and the
codebase actually cashes that in rather than just asserting it. `listMessageTokenUsage`
(`packages/database/src/repositories/messages.ts`), the query `cost-tracking.service.ts` sums for
spec §14's Cost Tracking, filters straight on `Message.organizationId`:

```ts
export async function listMessageTokenUsage(
  organizationId: string,
  filters: { conversationId?: string; userId?: string; since?: Date } = {},
): Promise<MessageCostAggregate[]> {
  const { conversationId, userId, since } = filters;
  const rows = await prisma.message.findMany({
    where: {
      organizationId,
      role: 'ASSISTANT',
      tokenUsage: { not: Prisma.JsonNull },
      ...(conversationId && { conversationId }),
      ...(userId && { conversation: { createdById: userId } }),
      ...(since && { createdAt: { gte: since } }),
    },
    select: { model: true, tokenUsage: true, createdAt: true },
  });
  return rows;
}
```

Every field in that `where` is on `Message` itself or (for the optional `userId` filter) reached
through a single relation traversal that Prisma compiles to a join — but the organization scope, the
one clause present on *every* call, never needs one. `@@index([organizationId])` on `Message`
exists for precisely this access pattern: "every message this org's assistant produced," aggregated
without first walking through `Conversation`. The same repository comment notes the flip side of
`userId` being nullable on `Message`: ASSISTANT rows (the ones carrying `tokenUsage`) have
`userId: null` — only a `USER` message has an author — so "per user" cost is attributed via the
*owning Conversation's* `createdById` (the `conversation: { createdById: userId }` filter above),
not `Message.userId` directly.

## Streaming transport: SSE via `createSseStream`

`/api/bond/chat` doesn't return a JSON envelope — `apiHandler`/`apiSuccess` are JSON-only by design,
so a generic streaming helper lives beside them instead:

```ts
/**
 * SSE transport for streaming route handlers — `apiHandler`/`apiSuccess`
 * are JSON-envelope-only by design (see api-handler.ts), so a streaming
 * response needs a different shape. Generic over the event type so it has
 * no knowledge of any one feature's event union.
 *
 * Pre-stream errors (auth/validation, thrown before the generator's first
 * `.next()`) must be surfaced as a normal JSON error response — the caller
 * primes the generator with one `await generator.next()` BEFORE calling
 * this function, inside the same `apiHandler` try/catch as everything else,
 * so those errors take the usual JSON-error path (headers haven't been
 * sent yet at that point). This function only ever handles what happens
 * AFTER that first successful event — in-stream errors are caught here and
 * emitted as a final SSE `error` event instead, since the HTTP status can
 * no longer change once bytes are flowing.
 */
export function createSseStream<T>(generator: AsyncGenerator<T>, primed: IteratorResult<T>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (event: T | { type: 'error'; message: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        if (!primed.done) {
          enqueue(primed.value);
          for await (const event of generator) {
            enqueue(event);
          }
        }
      } catch (error) {
        const message = isAppError(error) ? error.message : 'Something went wrong.';
        log.error('Stream error', { message: error instanceof Error ? error.message : String(error) });
        enqueue({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await generator.return(undefined as never).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

`createSseStream` is generic over the event type `T` — it has no import from, or knowledge of,
`BondStreamEvent` — so the "prime, then stream" split is a reusable transport pattern, not something
baked into the Bond feature. The one, and so far only, caller is `/api/bond/chat`
(`apps/web/app/api/bond/chat/route.ts`), which does exactly what the doc comment describes: prime
inside `apiHandler`'s own try/catch, then hand both the primed result and the still-live generator to
`createSseStream`:

```ts
export const POST = apiHandler(
  withRateLimit(
    async (request) => {
      assertSameOrigin(request);
      const { user } = await requireAuth();
      const organizationId = await requireActiveOrganizationId();
      const body = await parseJsonBody(request, sendBondMessageSchema);

      const generator = runBondChatPipeline(organizationId, user.id, body);
      // Primed here, inside apiHandler's try/catch, so auth/validation/
      // not-found errors before the first event still return as a normal
      // JSON error response — see streaming-handler.ts's doc comment.
      const first = await generator.next();

      return createSseStream(generator, first);
    },
    { limit: 20, windowSeconds: 60 },
  ),
);
```

`runBondChatPipeline` (docs/rag.md) is the `AsyncGenerator<BondStreamEvent>` being drained — its
first `yield` is always `{ type: 'status', stage: 'retrieving' }`, emitted only after auth, the
request body, and the target conversation have all been resolved, which is what makes priming safe:
anything that can still throw (bad auth, a malformed body, a `conversationId` that doesn't belong to
this org) throws before that first `yield`, while control is still inside `generator.next()` and thus
still inside `apiHandler`'s try/catch. This route is also rate-limited tighter than the shared
default (20/minute vs. the usual higher limit) because, per the route's own comment, a single turn
can involve several LLM round-trips — the most expensive request shape in the codebase.

## The event contract: `BondStreamEvent`

`apps/web/features/bond/lib/stream-events.ts` is the wire contract both sides agree on — its own
header explains why it's kept dependency-free:

```ts
/**
 * `/api/bond/chat`'s SSE event shapes — imported by both the server
 * pipeline and client chat components, so it deliberately has zero
 * server-only imports (no `@bond-os/database`/`@bond-os/auth` types).
 */

export interface BondCitation {
  ref: string;
  documentId: string | null;
  documentTitle: string | null;
  page: number | null;
  chunkId: string | null;
  entityId: string | null;
  entityTitle: string | null;
  confidence: number;
}

export type BondStreamEvent =
  | { type: 'status'; stage: 'retrieving' | 'planning' | 'tool_call' | 'generating'; detail?: Record<string, unknown> }
  | { type: 'token'; text: string }
  | { type: 'citations'; citations: BondCitation[] }
  | { type: 'suggestions'; questions: string[] }
  | {
      type: 'done';
      conversationId: string;
      messageId: string;
      model: string;
      tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
    }
  | { type: 'error'; message: string };
```

`BondCitation` is a plain, structurally-typed mirror of `apps/web/features/retrieval/services/
citation.service.ts`'s `Citation` (docs/retrieval.md) — kept as its own type here rather than
imported, since importing the retrieval feature's type would pull a server-only module boundary into
a file the client bundle also needs.

One turn of `runBondChatPipeline` yields these, in this order, every time:

1. `{ type: 'status', stage: 'retrieving' }` — right after the user's message is persisted, before
   `buildContext` runs.
2. `{ type: 'status', stage: 'planning', detail: { attempt } }` — once per tool-calling loop
   iteration, up to `BOND_MAX_TOOL_CALLS` (default 3; docs/tool-calling.md).
3. `{ type: 'status', stage: 'tool_call', detail: { tool } }` — only when that planning turn actually
   requested a tool.
4. `{ type: 'status', stage: 'generating' }` — once, right before the final streamed answer starts.
5. `{ type: 'token', text }` — one per chunk of `provider.stream(...)`, re-yielded immediately as it
   arrives; this is what makes the response feel token-by-token in the UI rather than arriving all at
   once.
6. `{ type: 'citations', citations }` — once, after `validateCitations` has finished (docs/citations.md).
7. `{ type: 'suggestions', questions }` — once, rule-based follow-up questions, never LLM-generated
   (`generateSuggestedQuestions`).
8. `{ type: 'done', conversationId, messageId, model, tokenUsage }` — the terminal event; `messageId`
   is the just-persisted `Message.id`, letting the client swap its optimistic local id for the real one.

`{ type: 'error' }` is different from the other six: it's never yielded by the pipeline itself.
`createSseStream` synthesizes it only when the generator throws mid-stream (see the transport section
above) — from the client's perspective it's indistinguishable from any other frame, but the pipeline
code has no branch that constructs one directly.

## Client-side stream consumption: `streamBondChat`

`apps/web/features/bond/lib/use-bond-chat.ts` is the client half of the contract: it `fetch`es
`/api/bond/chat`, reads the `Response.body` as raw bytes, and turns `\n\n`-delimited SSE frames back
into typed callback invocations:

```ts
export interface BondChatCallbacks {
  onStatus?: (stage: Extract<BondStreamEvent, { type: 'status' }>['stage'], detail?: Record<string, unknown>) => void;
  onToken?: (text: string) => void;
  onCitations?: (citations: BondCitation[]) => void;
  onSuggestions?: (questions: string[]) => void;
  onDone?: (event: Extract<BondStreamEvent, { type: 'done' }>) => void;
  onError?: (message: string) => void;
}
```

Framing is hand-rolled — buffer incoming text, split on the SSE frame separator, dispatch each
complete frame, keep the remainder for the next chunk:

```ts
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  let separatorIndex = buffer.indexOf('\n\n');
  while (separatorIndex !== -1) {
    const frame = buffer.slice(0, separatorIndex);
    buffer = buffer.slice(separatorIndex + 2);
    dispatchFrame(frame, callbacks);
    separatorIndex = buffer.indexOf('\n\n');
  }
}
```

and `dispatchFrame` is a straight `switch` over `BondStreamEvent['type']` fanning out to the matching
`on*` callback, e.g. `case 'token': callbacks.onToken?.(event.text); return;`. `streamBondChat` never
throws: a failed `fetch`, a non-OK response, and an in-stream `{ type: 'error' }` frame all resolve
through `callbacks.onError` instead, so `ChatThread` doesn't need its own try/catch around the call.

## Chat UI structure

**`apps/web/app/(dashboard)/bond/layout.tsx`** — the two-column shell for the whole section. A
server component: `requireAuth()` + `getActiveOrganization()` + `listConversationsService(...)` run
once per navigation, and the resulting list is handed to `<ConversationList>` in a sticky sidebar
next to whichever page is active (`{children}`).

**`apps/web/app/(dashboard)/bond/page.tsx`** — the `/bond` welcome state shown before any thread is
selected: an `EmptyState` with a `<NewConversationButton>` CTA. No data fetching of its own — auth/
org resolution already happened in the layout above it.

**`apps/web/app/(dashboard)/bond/[conversationId]/page.tsx`** — the actual chat surface (spec §9). A
thin server component: loads the `Conversation` row and its message history in parallel
(`getConversationService` / `listMessagesService`), filters to `USER`/`ASSISTANT` rows, maps them to
`BondChatMessage[]`, and hands off to `<ChatThread>` for everything that happens after the page
loads. It assumes the `Conversation` row already exists — creation happens via
`<NewConversationButton>`'s `POST /api/bond/conversations` call before the browser ever navigates
here.

**`apps/web/features/bond/components/chat-thread.tsx`** — the client component that owns all
streaming state for one conversation: the growing message list (an optimistic `USER` bubble appended
immediately on send, an `ASSISTANT` bubble built up token-by-token from `onToken`), the current
`status` stage, citations/suggestions once they land, and the `isStreaming` flag that disables the
composer. `handleSend` shows the whole flow end to end:

```ts
setMessages((prev) => [...prev, userMessage, assistantMessage]);
setIsStreaming(true);

await streamBondChat(
  { conversationId, content },
  {
    onStatus: (nextStage) => setStage(nextStage),
    onToken: (text) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId ? { ...message, content: message.content + text } : message,
        ),
      );
    },
    ...
    onDone: (event) => {
      setMessages((prev) =>
        prev.map((message) => (message.id === assistantId ? { ...message, id: event.messageId } : message)),
      );
      setStage(null);
      setIsStreaming(false);
    },
    onError: (message) => {
      toast.error(message);
      // Drop the placeholder if nothing was ever generated for it.
      setMessages((prev) => prev.filter((m) => !(m.id === assistantId && m.content.length === 0)));
    },
  },
  controller.signal,
);
```

An in-flight stream is aborted via `AbortController` if the thread unmounts (navigating away
mid-response), and a stage indicator ("Retrieving…" / "Thinking…" / "Searching (tool)…" /
"Generating…") fills the gap while the assistant bubble is still empty.

**`apps/web/features/bond/components/message-bubble.tsx`** — one chat turn. `USER` renders as plain,
right-aligned text; `ASSISTANT` renders through `<MarkdownMessage>` under a "Mr. Bond" label, with a
`Badge` showing only a citation *count* ("3 sources") — the component's own comment notes that
per-citation detail (document/page/entity) is a separate Source Panel concern, not this component's.
An empty-content `ASSISTANT` message (nothing streamed yet) renders `null`; `ChatThread`'s stage
indicator fills that visual gap instead of an empty bubble.

**`apps/web/features/bond/components/markdown-message.tsx`** — the rich-response renderer:
`react-markdown` + `remark-gfm` (tables, task lists) + `remark-math`/`rehype-katex` (math), syntax
highlighting with a copy-to-clipboard button for fenced code, and links forced to
`target="_blank" rel="noreferrer noopener"`. A fenced ` ```mermaid ` block is special-cased to
`<MermaidBlock>` instead of syntax-highlighted code.

**`apps/web/features/bond/components/mermaid-block.tsx`** — lazily imports `mermaid` once
(module-level singleton promise) and renders a diagram definition to SVG client-side, explicitly
pinned to `securityLevel: 'strict'` — the library's own default — since the diagram definition being
rendered is LLM-authored text the model produced from (potentially attacker-shaped) retrieved
content; the component's comment is explicit that this must never be loosened.

**`apps/web/features/bond/components/prompt-box.tsx`** — the composer: Enter sends, Shift+Enter
inserts a newline, disabled while `isStreaming`.

**`apps/web/features/bond/components/suggested-questions.tsx`** — the row of follow-up chips
rendered from the `suggestions` event; renders nothing (not even an empty container) when there are
none.

**`apps/web/features/bond/components/conversation-list.tsx`** — the sidebar rendered by
`bond/layout.tsx`. Receives its initial data as a server-fetched prop, then every pin/archive/delete
action hits `/api/bond/conversations/[id]` directly and calls `router.refresh()` to resync — it does
not call `streamBondChat` or touch `/api/bond/chat` at all; conversation metadata and chat turns are
two separate write paths.

**`apps/web/features/bond/components/citation-badge.tsx`, `model-selector.tsx`,
`memory-status.tsx`** — three components that exist, are fully implemented, and are not currently
imported by `ChatThread` or any page under `bond/`. `CitationBadge` (a clickable per-citation chip
with a confidence percentage) is built for a "Source Panel" that opens on click, per its own doc
comment; `ModelSelector` (the spec §9 per-message model override, populated from `GET /api/ai/
models`) already forwards to `/api/bond/chat`'s optional `model` field once wired up; `MemoryStatus`
is a trivial "Using last N messages" badge. Each is a real, working component sitting unreached
behind the current UI, not a stub — the same "built ahead of its caller" pattern docs/ai-service.md
documents for `generate()`/`stream()` in the phase before this one.

## What's deliberately not built

- **No native per-provider function-calling in the transport.** `BondStreamEvent`'s `status`
  variant carries a `tool_call` stage for UI feedback, but the wire contract has no event that hands
  a tool schema to the client or expects one back — tool dispatch is entirely server-side
  (docs/tool-calling.md); the client only ever observes that a tool ran, it never drives one.
- **No message editing or regeneration.** `apps/web/app/api/bond/conversations/[id]/messages/route.ts`
  exports only `GET`, and says so in its own doc comment: "Deliberately GET-only — sending a message
  happens exclusively through the RAG pipeline (`/api/bond/chat`'s SSE stream), never through a plain
  create-message endpoint, so no second write path can bypass retrieval." There is no "regenerate
  response" affordance in `ChatThread` and no repository function that updates a `Message` row after
  creation — `createMessage` is called once per turn and the row is immutable after that.
- **No multi-user presence or typing indicators.** The stream is a private request/response between
  one caller and the pipeline; nothing broadcasts `status`/`token` events to other members viewing
  the same organization, and `Conversation` has no notion of "who else is here."
- **No offline queueing or retry.** `streamBondChat` surfaces a network failure via `onError`
  immediately; there's no local queue that re-sends a message once connectivity returns.
- **No client-persisted chat state beyond the current page.** `ChatThread`'s message list is React
  state seeded from one server render; refreshing the page re-fetches history from
  `listMessagesService` rather than reading from any client cache or `localStorage`.
