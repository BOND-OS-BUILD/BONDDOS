# Context Builder

## Scope

`apps/web/features/retrieval/services/context-builder.service.ts` — one file, one exported function,
`buildContext(organizationId, question, tokenBudget?)`. It turns a question into a
token-budgeted bundle of everything downstream AI generation needs: retrieved chunks/entities,
1-hop knowledge-graph expansion, recent timeline activity, and linked Phase 1 records (projects,
customers, meetings) — by assembling **on top of** [Retrieval](./retrieval.md), never by re-querying
independently. This is the single call both [`runBondChatPipeline`](./rag.md) and
`runThinkLoop` (the shared multi-agent reasoning engine, see [Agents Overview](../agents/overview.md))
make to go from "the user's question" to "material an LLM can actually be shown."

## Input / output

```ts
export async function buildContext(
  organizationId: string,
  question: string,
  tokenBudget?: number,
): Promise<AssembledContext>
```

`tokenBudget` is optional — when omitted it falls back to the `CONTEXT_TOKEN_BUDGET` env var
(`packages/shared/src/env.ts`, `z.coerce.number().int().positive().default(8000)`):

```ts
const budget = tokenBudget ?? getEnv().CONTEXT_TOKEN_BUDGET;
```

In the real caller (`runBondChatPipeline`), `tokenBudget` is never actually omitted — it's always
`config.contextWindow`, the effective per-organization AI config resolved by
`resolveEffectiveAiConfigService` (org's `OrganizationAiSettings.contextWindow` if set, else this
same env default). See [the token-budget double-counting note](#the-same-numeric-budget-is-spent-twice)
below for why that matters.

Output shape:

```ts
export interface AssembledContext {
  question: string;
  documents: LinkedRecordRef[];
  chunks: ContextItem[];
  entities: ContextItem[];
  connectedEntities: Array<{ id: string; title: string; entityType: string; depth: number }>;
  timelineEvents: Array<{ id: string; description: string; eventType: string; entityTitle: string }>;
  projects: LinkedRecordRef[];
  customers: LinkedRecordRef[];
  meetings: LinkedRecordRef[];
  totalTokens: number;
  tokenBudget: number;
  truncated: boolean;
  /** The retrieve() results this context was built from — buildPrompt/citation callers need these for buildCitations, avoiding a second, wasted retrieve() call. */
  rawResults: HybridSearchResult[];
}
```

The `rawResults` field is what lets [Prompt Builder](./prompt-builder.md) build a full citation list
(`buildCitations(context.rawResults)`) from *every* retrieved candidate — not just the ones that
survived this function's own token-budget cutoff — without a second `retrieve()` call. See
[Citations](./citations.md) for why that distinction matters for what a model is allowed to cite.

## Assembly is greedy and deterministic

```ts
const results = await retrieve(organizationId, question, { limit: 30 });
const contentByKey = await resolveContent(organizationId, results);

const items: ContextItem[] = [];
let totalTokens = countTokensService(question);
let truncated = false;

for (const result of results) {
  const info = contentByKey.get(result.key);
  const content = info?.content ?? result.snippet;
  const tokens = countTokensService(content);

  if (totalTokens + tokens > budget) {
    truncated = true;
    break;
  }

  items.push({ key: result.key, kind: result.kind, title: result.title, content, score: result.score, tokens });
  totalTokens += tokens;
}
```

`retrieve(organizationId, question, { limit: 30 })` is the **one and only** line in this function
(and, transitively, in the whole [RAG pipeline](./rag.md)) that turns the question into retrieved
material — 30 is a hardcoded literal here, not read from any per-org config (see
[the retrievalDepth gap](#gap-resolveeffectiveaiconfigservices-retrievaldepth-appears-unused) below).
`retrieve()` already returns results ranked highest-score-first
([Hybrid Search](./retrieval.md#hybrid-search-4-signals-one-ranked-list)), so `buildContext` never
re-sorts — it walks the list in the order received, adding one item at a time, and **stops**
(`break`, not skip-and-continue) the instant the next item would push `totalTokens` over budget.

Because the ranking that produced `results` is itself deterministic and the loop never reorders or
skips ahead to find a smaller item that *would* fit, the same question against the same org and
budget always produces the same cutoff — no randomness, no "try the next one down the list" fallback
that could make the truncation boundary fuzzy. Contrast this with
[Prompt Builder's own budgeting pass](./prompt-builder.md#token-budgeting-skip-not-break), which
*does* skip-and-continue rather than break — the two layers deliberately use different strategies at
different granularities.

### `resolveContent` — one batched content-resolution pass

```ts
async function resolveContent(organizationId: string, results: HybridSearchResult[]): Promise<Map<string, ContentInfo>>
```

A single `Promise.all` over two batched Prisma queries — `prisma.chunk.findMany` and
`prisma.entity.findMany`, both filtered by `id: { in: [...] }` — resolves full `content` for every
`CHUNK`/`ENTITY` candidate in the result set at once, keyed by the same `${kind}:${id}` identity
`hybridSearch` already uses. Both queries are **still org-scoped**
(`knowledgeDocument: { organizationId }` / `organizationId` directly) even though the candidate ids
already came from an org-scoped `retrieve()` call — defense in depth, not just trusting the caller's
pre-check. `EMAIL`/`MEETING` candidates have no content-resolution branch here; they fall through to
`result.snippet` (whatever `hybrid-search.service.ts` already populated from the embedding's own
stored content).

If a candidate has no resolved content (the map lookup misses), the loop falls back to
`result.snippet` — so a `CHUNK`/`ENTITY` row deleted between retrieval and this resolution pass
degrades to its shorter snippet rather than being dropped outright.

## Real tokens, not a heuristic

`countTokensService` (`@/features/ai/services/ai.service`) delegates straight to `@bond-os/ai`'s
`countTokens`:

```ts
export function countTokens(text: string): number {
  return encode(text).length;
}
```

`gpt-tokenizer`'s `encode`, `cl100k_base` — an actual BPE tokenizer, not a `text.length / 4`-style
estimate. It lives in its own file, `packages/ai/src/tokenizer.ts`, deliberately separate from
`@bond-os/ai`'s provider/generation code, and works with **zero AI provider configured** — budgeting
context is arithmetic on text, and Context Builder needs an accurate token count regardless of
whether `AI_PROVIDER` is even set (retrieval/embeddings never require generation to be configured).
The caveat both this codebase's comments and [Providers](./providers.md) note: Claude/Gemini use
different internal tokenizers than OpenAI's `cl100k_base`, so this is a close, consistent
approximation across all four providers — not an exact count for every one of them.

## Lazy context loading — KG expansion only for the top 5

Fetching 1-hop connected entities and timeline events for *every* entity that made it into context
would mean two extra queries per item. Instead, only the top `TOP_ITEMS_FOR_EXPANSION` (5)
highest-ranked entity items get expanded:

```ts
const TOP_ITEMS_FOR_EXPANSION = 5;

const topEntityIds = items
  .filter((item) => item.kind === 'ENTITY')
  .slice(0, TOP_ITEMS_FOR_EXPANSION)
  .map((item) => item.key.slice('ENTITY:'.length));

const [connectedNested, timelineNested, linkedRecords] = await Promise.all([
  Promise.all(topEntityIds.map((id) => findConnectedEntities(id, organizationId, 1))),
  Promise.all(topEntityIds.map((id) => getTimeline(id, { organizationId, page: 1, pageSize: 5 }))),
  resolveLinkedRecords(organizationId, topEntityIds),
]);
```

Since `items` is already in rank order (it was built by walking `results`, which `hybridSearch`
already sorted), `slice(0, 5)` is sufficient — no re-sorting needed. `findConnectedEntities` (1-hop
only — the third argument is `maxDepth: 1`) and `getTimeline` (`page: 1, pageSize: 5`) are both
reused directly from the [Knowledge Graph](../knowledge/graph.md) layer; no new graph-walking or
timeline logic exists in this file.

`connectedNested`/`timelineNested` are arrays-of-arrays (one inner array per expanded entity) —
flattened with `.flat()`/`.flatMap()` into the final `connectedEntities`/`timelineEvents` lists on
`AssembledContext`.

## Linked records: two different resolution paths

`resolveLinkedRecords(organizationId, topEntityIds)` resolves Project/Customer/Meeting records that
the top-ranked entities reference, using two different strategies depending on what the
[extraction/soft-linking layer](../knowledge/resolution.md) already provides:

```ts
for (const entity of entities) {
  const metadata = entity.metadata as Record<string, unknown> | null;
  if (metadata && typeof metadata === 'object') {
    if (metadata.linkedRecordType === 'PROJECT' && typeof metadata.linkedRecordId === 'string') {
      projectIds.add(metadata.linkedRecordId);
    }
    if (metadata.linkedRecordType === 'MEETING' && typeof metadata.linkedRecordId === 'string') {
      meetingIds.add(metadata.linkedRecordId);
    }
  }
  if (entity.entityType === 'CUSTOMER') customerNames.add(entity.title);
}
```

- **`PROJECT`/`MEETING` mentions** carry a soft link (`Entity.metadata.linkedRecordType` /
  `linkedRecordId`) straight to the real Phase-1 record, set up by the
  [extraction pipeline](../knowledge/extraction.md) at ingestion time — so these two are a direct id
  lookup (`prisma.project.findMany({ where: { id: { in: [...] } } })`, same for meetings).
- **`CUSTOMER` mentions have no soft-link mechanism** — there's no `linkedRecordType: 'CUSTOMER'` to
  read, so Context Builder falls back to an exact-title, case-sensitive match against the real
  `Customer` table:

  ```ts
  customerNames.size > 0
    ? prisma.customer.findMany({ where: { name: { in: Array.from(customerNames) }, organizationId }, select: { id: true, name: true } })
    : Promise.resolve([]),
  ```

  This is the same deterministic "exact match, no fuzzy guessing" rule the
  [entity resolution layer](../knowledge/resolution.md) already uses elsewhere — Context Builder
  doesn't introduce a new matching strategy for the one entity type extraction didn't cover, it
  reapplies the existing one at a different layer.

## The same numeric budget is spent twice

`runBondChatPipeline` passes `config.contextWindow` as **both** `buildContext`'s `tokenBudget` and
[`buildPrompt`](./prompt-builder.md)'s `tokenLimit`:

```ts
const context = await buildContext(organizationId, rewrittenQuery, config.contextWindow);
const built = buildPrompt(context, context.rawResults, { id: organization.id, name: organization.name }, config.contextWindow, { ... });
```

These are two independent greedy budgeting passes against the *same* numeric ceiling, but at
different granularities:

- Context Builder's pass only counts `question` tokens + each candidate's raw `content`/`snippet`
  tokens.
- Prompt Builder's pass additionally has to fit the system message (preamble, injection guard, org
  line, memory facts), every conversation-history turn, and each context item's *formatted* line
  (`[ref] (from "title"): content`, which is strictly longer than the raw content alone) — all against
  that same ceiling.

Concretely, this means an item that fit comfortably inside Context Builder's budget can still be
skipped by Prompt Builder's own pass, because Prompt Builder's fixed overhead (system message +
history) eats into the same numeric limit before any context line is even considered. `buildContext`'s
`truncated: false` does not guarantee `buildPrompt`'s own `truncated` will also be `false` for the
same turn — they are two separate flags computed independently, both surfaced in different places
(`AssembledContext.truncated` vs. `BuiltPrompt.truncated`, the latter logged in `bond.chat`'s audit
metadata).

## Gap: `resolveEffectiveAiConfigService`'s `retrievalDepth` appears unused

`ai-settings.service.ts`'s `resolveEffectiveAiConfigService` resolves a `retrievalDepth` field
(defaulting to `30` if unset anywhere in org settings or env):

```ts
return {
  providerId,
  model,
  ...
  contextWindow: settings?.contextWindow ?? env.CONTEXT_TOKEN_BUDGET,
  retrievalDepth: settings?.retrievalDepth ?? 30,
};
```

But `buildContext`'s actual `retrieve()` call hardcodes its own `limit: 30` directly:

```ts
const results = await retrieve(organizationId, question, { limit: 30 });
```

`config.retrievalDepth` is never read anywhere in `context-builder.service.ts`, and grepping the
codebase for other readers of `retrievalDepth` turns up none in the retrieval/context-building path.
The coincidence that both values default to `30` makes this easy to miss — but they are two
independent literals, not one flowing into the other. This looks like a currently-unused
configuration field (present in the database schema and the resolved config object, exposed on the
AI Settings admin UI, but not actually consulted by the one function whose name suggests it should
control it) rather than a deliberate design decision documented anywhere as intentional. Worth
verifying with the codebase owner before relying on `retrievalDepth` doing anything today.

## What's deliberately not built

- **No summarization of included content.** Chunks and entities go into the bundle as their raw
  stored text (`chunk.content`, or `[entity.title, entity.description].filter(Boolean).join('\n\n')`),
  never condensed or rewritten.
- **No cross-question memory.** Each `buildContext` call is fully independent — nothing from one
  question's assembled context is cached or reused for the next, even within the same conversation.
  (Conversation-level memory is a separate concern; see [Memory](./memory.md).)
- **No streaming assembly.** `buildContext` is one synchronous (`await`-chained) call that returns
  the complete `AssembledContext` bundle in one shot, not an incremental/streamed sequence of partial
  results.

## See also

- [Retrieval](./retrieval.md) — the `retrieve()`/`hybridSearch()` call this function builds on.
- [Prompt Builder](./prompt-builder.md) — what happens to `AssembledContext` next.
- [RAG Pipeline](./rag.md) — the end-to-end flow this function is one stage of.
- [Knowledge Graph](../knowledge/graph.md) — `findConnectedEntities`/`getTimeline`, reused here
  unchanged.
- [Entity Resolution](../knowledge/resolution.md) — the soft-linking convention
  `resolveLinkedRecords` reads.
