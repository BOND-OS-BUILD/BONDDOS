# Context Builder (Phase 4)

## Scope

Spec §6: turn a question into a token-budgeted bundle of the material future AI generation would
need — documents, chunks, entities, connected entities, timeline events, and linked Phase 1 records
— by assembling on top of retrieval, not by re-querying independently.
`apps/web/features/retrieval/services/context-builder.service.ts`, one file, one exported function,
`buildContext`. See docs/retrieval.md for the `retrieve()` call this builds on.

## Input / output

```ts
export async function buildContext(
  organizationId: string,
  question: string,
  tokenBudget?: number,
): Promise<AssembledContext>
```

`tokenBudget` is optional — when omitted it falls back to the `CONTEXT_TOKEN_BUDGET` env var
(`packages/shared/src/env.ts`, `z.coerce.number().int().positive().default(8000)`, `.env.example`
ships it as `8000`):

```ts
const budget = tokenBudget ?? getEnv().CONTEXT_TOKEN_BUDGET;
```

Output:

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
}
```

## Assembly is greedy and deterministic

`retrieve()` already returns results ranked highest-score-first (docs/retrieval.md), so
`buildContext` doesn't re-sort anything — it walks the list in the order it received it, adding one
item at a time, and **stops** (`break`, not skip-and-continue) the instant the next item would push
`totalTokens` over budget:

```ts
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

Because the ranking that produced `results` is itself deterministic and the loop never reorders or
skips ahead to find a smaller item that *would* fit, the same question against the same org and
budget always produces the same cutoff — no randomness, no "try the next one down the list" fallback
that could make the boundary fuzzy.

## Real tokens, not a heuristic

`countTokensService` (`@/features/ai/services/ai.service`) delegates straight to `@bond-os/ai`'s
`countTokens`:

```ts
export function countTokens(text: string): number {
  return encode(text).length;
}
```

That's `gpt-tokenizer`'s `encode`, cl100k_base — an actual tokenizer, not a `text.length / 4`-style
estimate. It lives in its own file, `packages/ai/src/tokenizer.ts`, deliberately separate from
`@bond-os/ai`'s provider/generation code:

```ts
/**
 * Provider-agnostic token counting (cl100k_base), usable without
 * instantiating any `AIProvider` — the Context Builder needs accurate token
 * budgets regardless of whether an `AI_PROVIDER` is even configured
 * (retrieval/embeddings never require AI generation to be set up).
 */
```

`countTokensService`'s own comment makes the same point at the call site: `/** No org check, no
provider needed — a pure local computation the Context Builder calls freely. */`. Budgeting context
is arithmetic on text, and works whether or not any AI provider is configured — same spirit as
retrieval never calling `@bond-os/ai`'s generation surface (docs/retrieval.md).

## Lazy context loading (Performance §16)

Fetching 1-hop connected entities and timeline events for *every* entity that made it into the
context would mean one extra pair of queries per item. Instead, only the top
`TOP_ITEMS_FOR_EXPANSION` (5) highest-ranked entity items get expanded — the items array is already
in rank order, so `slice(0, TOP_ITEMS_FOR_EXPANSION)` is enough:

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

`findConnectedEntities` and `getTimeline` are both reused straight from Phase 3
(docs/knowledge-graph.md) — no new graph-walking or timeline logic here, just a bound on how many
items trigger it.

## Linked records: two different resolution paths

Projects, customers, and meetings referenced by the entities in context are resolved by
`resolveLinkedRecords`, and it uses two different strategies depending on what Phase 3 already gave
it to work with:

```ts
/** PROJECT/MEETING mentions carry a soft link (Phase 3's `metadata.linkedRecordType`) to the real Phase 1 record; CUSTOMER mentions have no soft-link mechanism, so an exact-title match against the real `Customer` table is used instead — the same deterministic "exact match, no fuzzy guessing" approach Phase 3 already established. */
async function resolveLinkedRecords(
  organizationId: string,
  entityIds: string[],
): Promise<{ projects: LinkedRecordRef[]; customers: LinkedRecordRef[]; meetings: LinkedRecordRef[] }> {
```

`PROJECT`/`MEETING` mentions already carry Phase 3's soft link
(`Entity.metadata.linkedRecordType`/`linkedRecordId`, docs/knowledge-graph.md's "Soft-linking"
section) straight to the real Phase 1 record, so those two are a direct id lookup:

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

`CUSTOMER` mentions never got a soft-link mechanism in Phase 3 — there's no `linkedRecordType:
'CUSTOMER'` to read. So the Context Builder falls back to an exact-title match against the real
`Customer` table:

```ts
customerNames.size > 0
  ? prisma.customer.findMany({ where: { name: { in: Array.from(customerNames) }, organizationId }, select: { id: true, name: true } })
  : Promise.resolve([]),
```

That's the same deterministic "exact match, no fuzzy guessing" rule Phase 3 already established for
Project/Meeting soft-linking (docs/knowledge-graph.md) — the Context Builder doesn't introduce a new
matching strategy for the one entity type Phase 3 didn't cover, it reapplies the existing one at a
different layer.

## What's deliberately not built

No summarization of included content — chunks and entities go into the bundle as their raw stored
text (`chunk.content`, or `[entity.title, entity.description].filter(Boolean).join('\n\n')`), never
condensed or rewritten. No cross-question memory — each `buildContext` call is fully independent;
nothing from one question's assembled context is cached or reused for the next, even within the same
conversation. No streaming assembly — `buildContext` is one synchronous (`await`-chained) call that
returns the complete `AssembledContext` bundle in one shot, not an incremental/streamed sequence of
partial results.
