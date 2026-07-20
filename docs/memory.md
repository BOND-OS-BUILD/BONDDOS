# Memory Service

## Scope

Spec §8 is explicit: "Memory is deterministic. No AI-generated summaries." This phase builds
exactly that — `apps/web/features/retrieval/services/memory.service.ts` is a set of joins and
aggregations over data Phases 1–3 already created (entities, relationships, projects, customers,
embeddings). "Memory" here means **everything already known about X, pre-assembled** — not an
AI's recollection of it, not a generated digest, not a summary. There is intentionally no LLM call
anywhere in this file; that's the correct reading of the spec, not a missing feature.

```ts
/**
 * Memory Service (spec §8): deterministic long-term/entity/project/customer
 * memory — joins and aggregations over existing Phase 1/2/3 data. No
 * summarization, no generated text; "memory" means "everything already
 * known about X, pre-assembled," not an AI's recollection of it.
 */
```

## Four memory scopes

### Entity memory

`getEntityMemoryService(organizationId, entityId)` reuses Phase 3's `getEntityDetailService`
wholesale:

```ts
/** Reuses Phase 3's Entity Viewer data wholesale — entity memory IS the entity's full graph detail, nothing new to compute. */
export async function getEntityMemoryService(organizationId: string, entityId: string): Promise<EntityDetail> {
  return getEntityDetailService(organizationId, entityId);
}
```

There's no new query here because there's nothing new to compute: "everything known about this
entity" is precisely what the Entity Viewer (see docs/graph-api.md / docs/knowledge-graph.md)
already assembles — attributes, relationships, mentions, embeddings. Memory doesn't reinterpret
that data, it just re-exposes it under the memory naming.

### Project memory

`getProjectMemoryService(organizationId, projectId)` pulls a project together with everything
that hangs off it — tasks, meetings, documents, emails, and customers — in a single `prisma`
query, then reshapes the nested `select` result into a flat `ProjectMemory` shape:

```ts
export interface ProjectMemory {
  project: { id: string; title: string; description: string | null; status: string };
  tasks: Array<{ id: string; title: string; status: string }>;
  meetings: Array<{ id: string; title: string; meetingDate: Date }>;
  documents: Array<{ id: string; title: string }>;
  emails: Array<{ id: string; subject: string; sentAt: Date }>;
  customers: Array<{ id: string; name: string }>;
}

export async function getProjectMemoryService(organizationId: string, projectId: string): Promise<ProjectMemory> {
  await requireRole(organizationId, ROLES.MEMBER);

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      tasks: { select: { id: true, title: true, status: true } },
      meetings: { select: { id: true, title: true, meetingDate: true } },
      documents: { select: { id: true, title: true } },
      emails: { select: { id: true, subject: true, sentAt: true } },
      customers: { select: { id: true, name: true } },
    },
  });
  if (!project) throw new NotFoundError('Project not found.');

  const { tasks, meetings, documents, emails, customers, ...projectFields } = project;
  return { project: projectFields, tasks, meetings, documents, emails, customers };
}
```

### Customer memory

`getCustomerMemoryService(organizationId, customerId)` is the same pattern narrowed to a
customer's emails and projects.

### Organization / long-term memory

`getOrganizationMemoryService(organizationId)` is the org-wide, always-current snapshot: total
entity/relationship/embedding/project/customer counts plus a recently-added list, built from
`getGraphAnalytics` and `getEmbeddingStats` (both already used elsewhere — see
docs/knowledge-graph.md) run in parallel with two `prisma.count()` calls:

```ts
/** "Long-term memory" — the org-wide, always-current snapshot; also backs the Memory Status page. */
export async function getOrganizationMemoryService(organizationId: string): Promise<OrganizationMemory> {
  await requireRole(organizationId, ROLES.MEMBER);

  const [graphAnalytics, embeddingStats, totalProjects, totalCustomers] = await Promise.all([
    getGraphAnalytics(organizationId),
    getEmbeddingStats(organizationId),
    prisma.project.count({ where: { organizationId } }),
    prisma.customer.count({ where: { organizationId } }),
  ]);

  return {
    totalEntities: graphAnalytics.totalEntities,
    totalRelationships: graphAnalytics.totalRelationships,
    totalEmbeddings: embeddingStats.total,
    totalProjects,
    totalCustomers,
    recentlyAdded: graphAnalytics.recentlyAdded,
  };
}
```

This is what backs the `/memory` "Memory Status" dashboard page
(`apps/web/app/(dashboard)/memory/page.tsx`): four `StatCard`s (entities, relationships,
embeddings, projects), a "recently added" list, and a customer count line — all read directly off
`OrganizationMemory`, no client-side computation.

## Authorization convention

Every exported function takes `organizationId` as its first argument and calls `requireRole`
itself — the same convention every other service in the codebase follows (see docs/graph-api.md,
docs/connectors.md). `getEntityMemoryService` is the one exception, and only because
`getEntityDetailService` already performs its own `requireRole` check; wrapping it a second time
would just double the check, not add safety. Every scope is bounded by `organizationId` in its
`where` clause (`findFirst({ where: { id, organizationId } })` for project/customer memory,
`organizationId` passed straight through for entity/org memory), so a caller can never read
another organization's memory by guessing an id.

## What's deliberately not built

- **No memory summarization or compression.** Every scope returns raw counts and lists — no LLM
  pass condenses "12 tasks, 4 meetings, 3 documents" into a paragraph. Summarization would require
  calling `generate()` (see docs/ai-service.md), which is explicitly out of scope for this phase.
- **No memory "decay" or archival.** `getOrganizationMemoryService` and friends always reflect
  everything currently in the organization — there's no notion of aging data out, marking it
  stale, or archiving it. That's a product/design decision (what counts as "stale"? on what
  timeline?) this phase doesn't make.
- **No per-user memory.** Every scope is organization-scoped, not personalized to the calling
  user — `getProjectMemoryService` returns the same `ProjectMemory` regardless of which member of
  the org calls it. Personalized memory (e.g. "what have I looked at recently") is a design
  decision layered on top of, not required by, "deterministic memory" as specified.

## Phase 5: Conversation Memory

Everything above this section is Phase 4's `apps/web/features/retrieval/services/memory.service.ts`
— entity/project/customer/organization memory — and is **untouched by Phase 5**. This section
documents a **different file**: `apps/web/features/bond/services/conversation-memory.service.ts`,
Bond's per-conversation memory for the RAG pipeline (spec §5). The file's own doc comment draws the
same distinction:

```ts
/**
 * Conversation Memory (spec §5) — deterministic, distinct from Phase 4's
 * `retrieval/services/memory.service.ts` (entity/project/customer/org
 * memory, untouched and reused elsewhere). Every function here derives
 * facts from rows that already exist; nothing is generated. "No
 * hallucinated summaries" — Phase 4's own stated rule for memory — applies
 * identically to conversation summaries and entity memory below.
 */
```

Same rule, same reason: everything below is a join or a template over `Message`/`Conversation` rows
that already exist — no LLM call anywhere in this file, and none of its three memory kinds (recent
history, summary, "important facts") is a generated digest of what happened, only a deterministic
reshaping of it.

### Recent conversation history — real turns, not a text blob

`getRecentConversationHistory` turns the last N `Message` rows into actual `ChatMessage[]` entries —
`{ role: 'user' | 'assistant' | 'system', content: string }`, the exact shape
`buildPrompt`'s `messages` array is made of (see docs/citations.md) — not a paragraph summarizing
what was said:

```ts
const DEFAULT_HISTORY_TURNS = 10;

function toChatMessage(message: MessageItem): ChatMessage | null {
  if (message.role === 'USER') return { role: 'user', content: message.content };
  if (message.role === 'ASSISTANT') return { role: 'assistant', content: message.content };
  return null;
}

/** Recent conversation memory — the last N turns, oldest-first, as real `{role, content}` messages ready to splice into `buildPrompt`'s `conversationHistory` option. TOOL/SYSTEM rows (if ever persisted) are dropped — `ChatMessage` has no `tool` role. */
export async function getRecentConversationHistory(
  organizationId: string,
  conversationId: string,
  limit = DEFAULT_HISTORY_TURNS,
): Promise<ChatMessage[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  const messages = await getRecentMessages(conversationId, organizationId, limit);
  return messages.map(toChatMessage).filter((message): message is ChatMessage => message !== null);
}
```

`getRecentMessages` (`packages/database/src/repositories/messages.ts`) does the actual fetch —
`ORDER BY createdAt DESC, take: limit`, then `.reverse()`s the page back to oldest-first before
returning, so the caller never has to re-sort:

```ts
/** Most recent N turns, returned oldest-first — the shape `conversation-memory.service.ts` needs to fold into a prompt's message array. */
export async function getRecentMessages(
  conversationId: string,
  organizationId: string,
  limit: number,
): Promise<MessageItem[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: messageInclude,
  });
  return rows.reverse().map(toItem);
}
```

`toChatMessage` maps `USER`/`ASSISTANT` `MessageRole` values onto `ChatMessage`'s two matching
roles and returns `null` for anything else, filtered out by the type-guarded `.filter(...)` — a
defensive no-op today, since nothing in this codebase currently persists a `SYSTEM` or `TOOL`
`Message` row, but a correct one regardless: `ChatMessage` (`packages/ai/src/types.ts`) only has
`'system' | 'user' | 'assistant'`, no `'tool'` role, so a hypothetical `TOOL` message could never be
represented faithfully anyway.

`rag-pipeline.service.ts` calls this with a hardcoded `10` — the same value as
`DEFAULT_HISTORY_TURNS` — and splices the result directly between the system message and the current
question in `buildPrompt`'s `messages` array via `BuildPromptOptions.conversationHistory`:

```ts
const history = await getRecentConversationHistory(organizationId, conversationId, 10);
```

### Extractive conversation summary — no model call

`summarizeConversation` builds a summary purely by picking out specific messages and templating them
into a sentence — first user message, turn count, most recent user/assistant exchange — never by
asking a model to condense anything:

```ts
/** Extractive conversation summary — first user message (topic) + turn count + the most recent exchange, templated. No model call. */
export function summarizeConversation(messages: MessageItem[]): string {
  if (messages.length === 0) return 'No messages yet.';

  const firstUser = messages.find((message) => message.role === 'USER');
  const lastUser = [...messages].reverse().find((message) => message.role === 'USER');
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'ASSISTANT');

  const parts: string[] = [];
  if (firstUser) parts.push(`Started with: "${firstUser.content.slice(0, 140)}"`);
  parts.push(`${messages.length} message${messages.length === 1 ? '' : 's'} so far.`);
  if (lastUser && lastUser.id !== firstUser?.id) parts.push(`Most recently asked: "${lastUser.content.slice(0, 140)}"`);
  if (lastAssistant) parts.push(`Last answer: "${lastAssistant.content.slice(0, 140)}"`);

  return parts.join(' ');
}
```

"Extractive" in the literal sense used for text summarization: every fragment in the output is a
substring lifted directly from an existing message (each capped to 140 characters — no attempt at a
clean word-boundary truncation), stitched together with fixed template phrases (`Started with:`,
`message(s) so far.`, `Most recently asked:`, `Last answer:`). Nothing is paraphrased, reworded, or
inferred. This function is synchronous, takes no `organizationId`, and does no authorization or
database work of its own — it's pure formatting over a `MessageItem[]` the caller already fetched,
same shape as `buildCitation` in docs/retrieval.md. It is **exported but has no caller anywhere in
this codebase yet** — `rag-pipeline.service.ts` uses `getRecentConversationHistory` (real turns) and
`getConversationMemoryFacts` (below) but not this function; it's a working, ready piece with no
wiring yet, the same honest "built, not yet reached" state docs/ai-service.md describes for
`generate()`/`stream()`.

### "Important facts" — entity memory derived from `Message.citations`

`getConversationMemoryFacts` is the one function in this file that reads from the database beyond
`getRecentMessages`, and it's still not a second retrieval pass — it aggregates over citations
*already validated and persisted* by a prior turn (docs/citations.md), never issuing a new search:

```ts
/** "Important facts" / entity memory (spec §5) — every entity a conversation's citations have touched, deduplicated by title. A deterministic aggregation over `Message.citations`, not a second retrieval pass. */
export async function getConversationMemoryFacts(organizationId: string, conversationId: string): Promise<string[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  const rawCitationLists = await getCitationRefsForConversation(conversationId, organizationId);

  const titles = new Set<string>();
  for (const rawList of rawCitationLists) {
    if (!Array.isArray(rawList)) continue;
    for (const entry of rawList as Citation[]) {
      const title = entry?.entityTitle ?? entry?.documentTitle;
      if (title) titles.add(title);
    }
  }

  return Array.from(titles).map((title) => `This conversation has previously discussed "${title}".`);
}
```

`getCitationRefsForConversation` (`packages/database/src/repositories/messages.ts`) is the thin
repository read backing it — every non-null `citations` Json value across the conversation's
messages, unopinionated about shape:

```ts
/** Every entity a conversation's citations have touched, deduplicated — the deterministic "entity memory" aggregation `conversation-memory.service.ts` uses. */
export async function getCitationRefsForConversation(conversationId: string, organizationId: string): Promise<unknown[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, organizationId, citations: { not: Prisma.JsonNull } },
    select: { citations: true },
  });
  return rows.map((row) => row.citations).filter((citations): citations is NonNullable<typeof citations> => citations !== null);
}
```

The service layer does the actual shaping: cast each row's raw `Json` back to `Citation[]`, pull
`entityTitle ?? documentTitle` off every entry, and de-duplicate by title into a `Set` before
templating each into a `"This conversation has previously discussed \"X\"."` sentence.
`rag-pipeline.service.ts` folds the resulting `string[]` into `buildPrompt` as `memoryFacts`, which
`buildPrompt` prefixes with `Known:` and appends to the system message — so "importance" here means
nothing more than "an entity or document this conversation's own retrieved-and-cited sources have
already surfaced," not a ranked or scored notion of significance.

### Why `Conversation.pinned` is the only "pinned memory" mechanism

Spec §5's "pinned memory" is not a separate concept with its own table in this codebase — it's the
one `pinned: Boolean` column already on `Conversation` (see docs/conversations.md), full stop. There
is no `PinnedFact` model, no per-message pin flag, no fact-level pinning table anywhere in
`packages/database/prisma/schema.prisma` — a search for `pin` across the whole schema turns up
exactly two lines, `Conversation.pinned` itself and its index:

```prisma
pinned         Boolean  @default(false)
...
@@index([organizationId, pinned])
```

Concretely, "pinning" in this codebase means marking an entire conversation (via
`updateConversationService({ pinned: true })`, docs/conversations.md) as one that should surface
first in the sidebar (`orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }]`) — it is a UI/ordering
concern, not an input to `conversation-memory.service.ts`. None of the three memory functions above
(`getRecentConversationHistory`, `summarizeConversation`, `getConversationMemoryFacts`) reads
`Conversation.pinned` at all; pinning a conversation doesn't change what gets fed into `buildPrompt`
for it, it only changes where that conversation appears in the list. A finer-grained "pin this
specific fact/message so it always makes it into context" mechanism — which is what "pinned memory"
usually implies — doesn't exist; the closest approximation this phase ships is pinning the whole
conversation so a user can find it again, not a memory-injection primitive.

### Memory expiration via `MEMORY_RETENTION_DAYS`

Conversation memory has no independent expiration logic of its own — no separate TTL job walks
`Message` rows and prunes old ones out of `getRecentConversationHistory`'s window. Expiration is
entirely inherited from `archiveOldConversationsService` (docs/conversations.md): the same
`MEMORY_RETENTION_DAYS` env var (default `90`, `packages/shared/src/env.ts`) that governs the manual
"Archive old conversations" admin action is the *only* notion of memory aging anywhere in Phase 5.
Archiving a `Conversation` doesn't delete its `Message` rows or purge it from history — an archived
conversation's messages remain fully readable via `GET /api/bond/conversations/[id]/messages` and
would still be picked up by `getRecentConversationHistory`/`getConversationMemoryFacts` if that
conversation's id were passed in again. "Expiration" here means "no longer surfaced in the default
conversation list," the same soft, reversible boundary docs/conversations.md describes for
`archived`, not a hard memory-eviction policy. As with the archive action itself, there is no
background job that enforces `MEMORY_RETENTION_DAYS` on a timer — it only takes effect when
`archiveOldConversationsService` is actually invoked.

### What's deliberately not built (Phase 5 additions)

- **No fact-level pinning.** As above — `Conversation.pinned` is conversation-granularity only; there
  is no way to pin an individual fact, citation, or message so it's guaranteed to stay in context
  across an arbitrarily long conversation.
- **No summarization-based context compression.** `getRecentConversationHistory` is a hard window of
  the last N raw turns (default 10) — once a conversation exceeds that, older turns simply fall out
  of `conversationHistory` entirely. There's no rolling summary that replaces dropped turns with a
  condensed stand-in; `summarizeConversation` exists and is extractive/non-LLM, but nothing in the
  pipeline currently calls it to backfill for turns that scrolled out of the window.
- **No cross-conversation memory.** `getRecentConversationHistory` and `getConversationMemoryFacts`
  are both scoped to a single `conversationId` — nothing folds facts learned in one conversation into
  a different one, even for the same user or organization. (Org-wide "everything known" is still
  Phase 4's `memory.service.ts`, documented above.)
- **No automatic, scheduled memory expiration.** Same caveat as docs/conversations.md's archive
  action: `MEMORY_RETENTION_DAYS` is a configured policy, not an enforced schedule, until something
  calls `archiveOldConversationsService`.
