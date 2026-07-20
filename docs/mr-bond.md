# Mr. Bond AI Copilot (Phase 5)

## Scope

Phase 5 builds BOND OS's chat product on top of everything Phases 1–4 already assembled: a
conversational surface where a user asks a question and gets back a streamed, cited answer grounded
in their organization's own data. `packages/database/prisma/schema.prisma`'s Phase 5 section states
the phase's one governing rule in its own header comment, and every doc in this index exists to show
that rule held in the actual code, not just asserted in a comment:

```prisma
// ── Phase 5: Mr. Bond AI Copilot ────────────────────────────────────────────
// Read-only RAG chat. Every answer goes through Phase 4's Retrieval Layer
// (hybridSearch/buildContext/buildPrompt/AI provider `stream()`) — no
// autonomous agents, no writes, no multi-agent systems. See docs/mr-bond.md,
// docs/chat.md, docs/rag.md.
```

Concretely, this phase is one feature folder (`apps/web/features/bond/`), three new/extended
database models (`Conversation`, `Message`, `OrganizationAiSettings` — docs/chat.md), one streaming
API route (`POST /api/bond/chat`) plus a handful of REST routes for conversation housekeeping
(`/api/bond/conversations/**` — docs/conversations.md), and a two-column chat UI under
`apps/web/app/(dashboard)/bond/**` (docs/chat.md). It is also the first phase where `packages/ai`'s
`AIProvider.generate()`/`.stream()` (docs/ai-service.md) get a real caller anywhere in BOND OS —
Phase 4's own doc comment on that interface said plainly that "nothing in this codebase actually
calls `generate()` or `stream()` this phase"; this is that phase.

## What Mr. Bond is

Mr. Bond is a **read-only retrieval-augmented-generation (RAG) copilot** — a chat interface, not an
actor. Every answer traces back to a call into Phase 4's Retrieval Layer for *that specific turn*;
there is no code path that hands a user's question straight to an LLM without first assembling
context from `buildContext`. `rag-pipeline.service.ts`, the single function `/api/bond/chat` drains,
states this as its opening design constraint:

```ts
/**
 * The RAG Pipeline (spec §3): User Question -> Query Rewrite -> Hybrid
 * Search -> Knowledge Graph Expansion -> Context Builder -> Prompt Builder
 * -> LLM -> Streaming Response -> Citations. "No shortcuts. Never bypass
 * retrieval." — every branch below runs through `buildContext` (which
 * itself calls `retrieve()`/`hybridSearch` and does KG expansion
 * internally, see context-builder.service.ts), there is no code path that
 * calls the AI provider without first assembling context from it.
 */
```

Within one turn, the model may request **one read-only tool per planning step**, bounded by
`BOND_MAX_TOOL_CALLS` (default 3, env-configurable 0–10) — not an open-ended agent loop, a fixed,
small number of extra lookups before an answer is required. Every tool is an existing, already
org-scoped, already read-only service; `tool-calling.service.ts` states the resulting guarantee
directly rather than leaving it as a convention to trust:

```ts
/**
 * Tool Calling — Read Only (spec §11-12). A prompt-marker convention
 * (`<<TOOL:name>>{...}`), not native per-provider function-calling — keeps
 * the Prompt Builder provider-independent (no per-provider `tools` wire
 * format to maintain) and lets tool dispatch be a single, fixed, hardcoded
 * switch. Every branch below calls an EXISTING, already org-scoped,
 * already read-only service — there is no code path from a tool call to
 * any write operation, which is the actual mechanism behind "NO write
 * operations," not just a prompt instruction.
 */
```

Every answer's citations are validated against what was actually retrieved before they're shown or
persisted — `validateCitations` drops any `[ref]` the model cites that wasn't in *this turn's* own
retrieved set, even if the referenced row genuinely exists elsewhere in the org (docs/citations.md).
And the only writes Mr. Bond itself performs are to its own `Conversation`/`Message` rows — persisting
the transcript, pinning/archiving/renaming/deleting a thread. It never creates a `Task`, edits a
`Project`, sends an `Email`, edits a `Meeting`, or updates a `Customer` row — see the exclusions
below for the evidence.

## What's deliberately not built

The spec is explicit that Phase 5 is a chat *interface* over existing capability, not a new actor in
the system. Each exclusion below is backed by an absence you can check for yourself, not just a
sentence in this doc:

- **No autonomous agents.** The tool-calling loop only ever runs *inside* a single
  `/api/bond/chat` request, triggered by a user's own message, bounded by
  `BOND_MAX_TOOL_CALLS` (`while (toolCallsUsed < maxToolCalls)` in `rag-pipeline.service.ts`), and it
  terminates the instant a planning turn stops requesting a tool. There is no process that wakes
  itself up, sets its own goals across turns, or keeps running once the HTTP request that started it
  completes.

- **No workflow execution.** `TOOL_NAMES` — the complete, fixed set of things a turn can ever
  invoke — is `['search', 'graph', 'timeline', 'documents', 'projects', 'meetings', 'customers',
  'emails', 'analytics']`. None of them is a workflow, and there is no workflow/automation engine
  anywhere in `apps/web/features/bond/` for one to run on.

- **No task creation.** There is no `Task` write anywhere in the Bond feature. The closest tool,
  `'projects'`, calls `listProjectsService` — a search/list read — and `executeToolCall`'s `switch`
  has no branch that calls anything named `create`/`update`/`delete`.

- **No project editing.** Same evidence as above: the `'projects'` tool only ever lists/searches
  projects for context; nothing in `tool-calling.service.ts` or the RAG pipeline calls
  `updateProjectService` or equivalent.

- **No email sending.** The `'emails'` tool calls `listEmailsService` to retrieve past emails as
  context, exactly like every other read tool — there is no send/compose capability wired into Mr.
  Bond, and no connector call originates from this feature folder.

- **No calendar editing.** The `'meetings'` tool calls `listMeetingsService`, read-only, for the
  same reason as the emails tool. No meeting is created, rescheduled, or cancelled by anything in
  this phase.

- **No CRM updates.** The `'customers'` tool calls `listCustomersService`. No branch in
  `executeToolCall` writes to `Customer`.

- **No background decision-making.** `runBondChatPipeline` runs synchronously for the lifetime of
  one HTTP request and yields its events directly into that request's SSE response
  (`createSseStream`, docs/chat.md) — there is no queue job, cron task, or worker anywhere in the
  codebase that invokes anything under `apps/web/features/bond/services/`. Nothing about Mr. Bond
  runs, decides, or acts except in direct, synchronous response to a user sending a message.

- **No multi-agent systems.** One `AIProvider` (docs/ai-service.md), resolved once per turn via
  `resolveEffectiveAiConfigService`, is the only model in the loop. `provider.generate()` is called
  for bounded planning turns and `provider.stream()` once for the final answer — the same single
  provider instance both times. There is no orchestration layer with named sub-agents that call each
  other, hand off state, or negotiate; it's one prompt, one model, one bounded tool loop, one
  streamed answer.

The Bond feature's own conversation/message CRUD (`PATCH`/`DELETE` on `/api/bond/conversations/[id]`
for pin/archive/rename/delete) is not an exception to "no writes" above — those endpoints mutate only
the chat app's own transcript metadata, never an organization's business data, and every one of them
is a direct user action (a click), never something Mr. Bond decides to do on its own.

## Documentation index

- **[docs/chat.md](./chat.md)** — the `Conversation`/`Message` data model, why `organizationId` is
  denormalized onto `Message`, the SSE streaming transport (`streaming-handler.ts` +
  `BondStreamEvent`), and the Chat UI component tree.
- **[docs/rag.md](./rag.md)** — the nine-stage RAG pipeline itself: Query Rewrite -> Hybrid Search ->
  KG Expansion -> Context Builder -> Prompt Builder -> LLM -> Streaming -> Citations, plus the
  prompt-injection mitigation applied to retrieved context.
- **docs/tool-calling.md** — the read-only tool-calling loop: the `<<TOOL:name>>` marker convention,
  the fixed `TOOL_NAMES` dispatch table, and why every branch terminates in an existing read service.
- **docs/conversations.md** — the `Conversation` CRUD surface (`/api/bond/conversations/**`): list,
  create, rename, pin, archive, delete, and the sidebar that drives it.
- **docs/citations.md** — how a citation is validated (membership against what was actually
  retrieved, then re-resolved) before it's ever persisted to `Message.citations` or shown.
- **[docs/memory.md](./memory.md)** — Phase 4's deterministic entity/project/customer/organization
  memory, the same "no hallucinated summaries" principle `conversation-memory.service.ts` applies to
  this phase's per-conversation history and cited-entity facts.
