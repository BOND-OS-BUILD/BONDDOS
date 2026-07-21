# Memory

## Scope

"Memory is deterministic. No AI-generated summaries." Two separate files implement this, at two
different scopes, and neither ever calls a generation model:

- **Organization memory** — `apps/web/features/retrieval/services/memory.service.ts`. Joins and
  aggregations over data that already exists elsewhere (entities, relationships, projects,
  customers, embeddings). "Memory" here means **everything already known about X, pre-assembled** —
  not an AI's recollection of it, not a generated digest.
- **Conversation memory** — `apps/web/features/bond/services/conversation-memory.service.ts`.
  Per-conversation memory feeding the [RAG pipeline](./rag.md): recent turns, an (unused) extractive
  summary, and "important facts" derived from a conversation's own prior citations.

```ts
/**
 * Conversation Memory — deterministic, distinct from
 * retrieval/services/memory.service.ts (entity/project/customer/org memory,
 * untouched and reused elsewhere). Every function here derives facts from
 * rows that already exist; nothing is generated. "No hallucinated
 * summaries" applies identically to conversation summaries and entity
 * memory below.
 */
```

Neither file imports anything from `@bond-os/ai`'s generation surface — the same "no LLM calls"
discipline as [Retrieval](./retrieval.md).

## Organization memory: four scopes, all reused data

### Entity memory — reuses the Entity Viewer wholesale

```ts
/** Reuses the Entity Viewer data wholesale — entity memory IS the entity's full graph detail, nothing new to compute. */
export async function getEntityMemoryService(organizationId: string, entityId: string): Promise<EntityDetail> {
  return getEntityDetailService(organizationId, entityId);
}
```

There's no new query here because there's nothing new to compute: "everything known about this
entity" is precisely what the Entity Viewer (see [Knowledge Graph](../knowledge/graph.md)) already
assembles — attributes, relationships, mentions, embeddings. This is the one function in the file
that does **not** call `requireRole` itself, and deliberately so: `getEntityDetailService` already
performs its own check; wrapping it a second time would just double the check, not add safety.

### Project memory / customer memory — one batched nested-select query each

`getProjectMemoryService(organizationId, projectId)` pulls a project together with everything that
hangs off it — tasks, meetings, documents, emails, customers — in a single `prisma.project.findFirst`
with a nested `select`, then reshapes the result into a flat `ProjectMemory` shape:

```ts
export interface ProjectMemory {
  project: { id: string; title: string; description: string | null; status: string };
  tasks: Array<{ id: string; title: string; status: string }>;
  meetings: Array<{ id: string; title: string; meetingDate: Date }>;
  documents: Array<{ id: string; title: string }>;
  emails: Array<{ id: string; subject: string; sentAt: Date }>;
  customers: Array<{ id: string; name: string }>;
}
```

`getCustomerMemoryService` is the same pattern narrowed to a customer's emails and projects.

### Organization / long-term memory — the always-current snapshot

```ts
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

Four parallel queries: `getGraphAnalytics` and `getEmbeddingStats` (both already used elsewhere — see
[Knowledge Graph](../knowledge/graph.md) and [Embeddings](./embeddings.md)) plus two direct
`prisma.count()` calls. This backs the `/memory` "Memory Status" dashboard page and is also what the
`analytics` [tool](./tool-calling.md) calls mid-conversation when Mr. Bond needs an organization-wide
snapshot.

### Authorization convention

Every exported function takes `organizationId` as its first argument and calls `requireRole` itself
(the exception being `getEntityMemoryService`, above). Every scope is bounded by `organizationId` in
its own `where` clause, so a caller can never read another organization's memory by guessing an id.

## Conversation memory: three kinds, one file

### Recent conversation history — real turns, not a text blob

```ts
const DEFAULT_HISTORY_TURNS = 10;

function toChatMessage(message: MessageItem): ChatMessage | null {
  if (message.role === 'USER') return { role: 'user', content: message.content };
  if (message.role === 'ASSISTANT') return { role: 'assistant', content: message.content };
  return null;
}

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

`getRecentMessages` (`packages/database/src/repositories/messages.ts`) does the fetch:
`ORDER BY createdAt DESC, take: limit`, then `.reverse()`s the page back to oldest-first so the
caller never has to re-sort. `toChatMessage` maps `MessageRole.USER`/`ASSISTANT` onto
`ChatMessage`'s two matching roles and returns `null` for anything else, filtered out by the
type-guarded `.filter(...)` — a defensive no-op today, since nothing in this codebase currently
persists a `SYSTEM` or `TOOL` `Message` row, but a correct one regardless:
`ChatMessage` (`packages/ai/src/types.ts`) only has `'system' | 'user' | 'assistant'`, no `'tool'`
role, so a hypothetical `TOOL` message could never be represented faithfully anyway.

`runBondChatPipeline` calls this with a hardcoded `10` (matching `DEFAULT_HISTORY_TURNS`) and splices
the result directly between the system message and the current question via
[`BuildPromptOptions.conversationHistory`](./prompt-builder.md#assembling-the-final-messages-array):

```ts
const history = await getRecentConversationHistory(organizationId, conversationId, 10);
```

### Extractive conversation summary — built, exported, and currently unused

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

"Extractive" in the literal text-summarization sense: every fragment is a substring lifted directly
from an existing message (each capped to 140 characters, no attempt at a clean word-boundary
truncation), stitched together with fixed template phrases. Nothing is paraphrased, reworded, or
inferred. This function is synchronous, takes no `organizationId`, and does no authorization or
database work of its own — pure formatting over a `MessageItem[]` the caller already fetched.

**Confirmed by a repo-wide search: this function has no caller anywhere in the codebase today.**
`runBondChatPipeline` and `runThinkLoop` both use `getRecentConversationHistory` (real turns) and
`getConversationMemoryFacts` (below), never `summarizeConversation`. It is a complete, working,
ready-to-use piece of code with no wiring — say so plainly rather than assuming it's reachable
somewhere, or removing it from documentation as if it didn't exist.

### "Important facts" — entity memory derived from `Message.citations`

```ts
/** "Important facts" / entity memory — every entity a conversation's citations have touched, deduplicated by title. A deterministic aggregation over Message.citations, not a second retrieval pass. */
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

This is the one function in the file that reads from the database beyond `getRecentMessages`, and
it's still not a second retrieval pass — it aggregates over citations **already validated and
persisted by a prior turn** (see [Citations](./citations.md)), never issuing a new search.
`getCitationRefsForConversation` (`packages/database/src/repositories/messages.ts`) is the thin
repository read backing it: every non-null `citations` `Json` value across the conversation's
messages, unopinionated about shape. The service layer casts each row back to `Citation[]`, pulls
`entityTitle ?? documentTitle` off every entry, and deduplicates by title into a `Set` before
templating each into a `"This conversation has previously discussed \"X\"."` sentence.
`runBondChatPipeline` folds the resulting `string[]` into `buildPrompt` as `memoryFacts`, which
[Prompt Builder](./prompt-builder.md#system-message-assembly) prefixes each with `Known:` and appends
to the system message. "Importance" here means nothing more than "an entity or document this
conversation's own retrieved-and-cited sources have already surfaced" — not a ranked or scored notion
of significance.

## `Conversation.pinned` is the only "pinned memory" mechanism

There is no separate table for pinned memory anywhere in the schema — it's the one
`pinned: Boolean @default(false)` column already on `Conversation`:

```prisma
pinned         Boolean  @default(false)
...
@@index([organizationId, pinned])
```

Concretely, "pinning" in this codebase means marking an entire conversation (via
`updateConversationService({ pinned: true })`) as one that should surface first in the sidebar
(`orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }]`) — a UI/ordering concern, not an input to
conversation memory. None of the three functions above (`getRecentConversationHistory`,
`summarizeConversation`, `getConversationMemoryFacts`) reads `Conversation.pinned` at all; pinning a
conversation doesn't change what gets fed into `buildPrompt` for it, only where that conversation
appears in the list. A finer-grained "pin this specific fact/message so it always makes it into
context" mechanism — which is what "pinned memory" usually implies — does not exist in this codebase.

## Memory expiration via `MEMORY_RETENTION_DAYS`

Conversation memory has no independent expiration logic of its own — no separate TTL job walks
`Message` rows and prunes old ones out of `getRecentConversationHistory`'s window. Expiration is
entirely inherited from the "Archive old conversations" admin action: the same
`MEMORY_RETENTION_DAYS` env var (default `90`, `packages/shared/src/env.ts`) that governs that manual
action is the only notion of memory aging anywhere in this layer. Archiving a `Conversation` doesn't
delete its `Message` rows or purge it from history — an archived conversation's messages remain
fully readable and would still be picked up by `getRecentConversationHistory`/
`getConversationMemoryFacts` if that conversation's id were passed in again. "Expiration" here means
"no longer surfaced in the default conversation list," not a hard memory-eviction policy. As with the
archive action itself, there is no background job that enforces `MEMORY_RETENTION_DAYS` on a timer —
it only takes effect when the archive action is actually invoked.

## What's deliberately not built

- **No memory summarization or compression at the organization scope.** Every scope in
  `memory.service.ts` returns raw counts and lists — no LLM pass condenses "12 tasks, 4 meetings, 3
  documents" into a paragraph. That would require calling `generate()` (see [Providers](./providers.md)),
  which this layer deliberately never does.
- **No memory "decay" or archival at the organization scope.** `getOrganizationMemoryService` and
  friends always reflect everything currently in the organization — no notion of aging data out,
  marking it stale, or archiving it.
- **No per-user memory.** Every organization-memory scope is organization-scoped, not personalized to
  the calling user — `getProjectMemoryService` returns the same `ProjectMemory` regardless of which
  member of the org calls it.
- **No fact-level pinning.** As above — `Conversation.pinned` is conversation-granularity only.
- **No summarization-based context compression for conversation history.**
  `getRecentConversationHistory` is a hard window of the last N raw turns (default 10) — once a
  conversation exceeds that, older turns simply fall out of `conversationHistory` entirely. There's
  no rolling summary that replaces dropped turns with a condensed stand-in; `summarizeConversation`
  exists and is extractive/non-LLM, but nothing in the pipeline currently calls it to backfill for
  turns that scrolled out of the window.
- **No cross-conversation memory.** `getRecentConversationHistory` and `getConversationMemoryFacts`
  are both scoped to a single `conversationId` — nothing folds facts learned in one conversation into
  a different one, even for the same user or organization.
- **No automatic, scheduled memory expiration.** `MEMORY_RETENTION_DAYS` is a configured policy, not
  an enforced schedule, until something calls the archive action.

## See also

- [RAG Pipeline](./rag.md) — where `getRecentConversationHistory` and `getConversationMemoryFacts`
  are called, once per turn.
- [Prompt Builder](./prompt-builder.md) — how `conversationHistory` and `memoryFacts` are folded into
  the final `messages` array.
- [Citations](./citations.md) — the validated citations `getConversationMemoryFacts` aggregates over.
- [Knowledge Graph](../knowledge/graph.md) — the Entity Viewer data `getEntityMemoryService` reuses
  wholesale.
- [Embeddings](./embeddings.md) — `getEmbeddingStats`, one of `getOrganizationMemoryService`'s two
  data sources.
