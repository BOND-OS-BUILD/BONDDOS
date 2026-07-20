# Tool Calling (Phase 5)

## Scope

Spec §11-12: let Mr. Bond fetch more information mid-answer when the retrieved context alone isn't
enough, without ever letting it write anything. One file,
`apps/web/features/bond/services/tool-calling.service.ts` — a fixed list of 9 tool names, a
prompt-marker parser, and a single hardcoded `switch` that dispatches each tool to an existing,
already-read-only, already-org-scoped service. Its own doc comment states the design in full:

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

The loop that drives this file — how many tool calls are allowed, and the "planning turns don't
stream, only the final answer streams" structure — lives one layer up, in
`apps/web/features/bond/services/rag-pipeline.service.ts`; see docs/rag.md for the rest of that
pipeline.

## Why a marker convention, not native per-provider function calling

BOND OS runs against four interchangeable providers (OpenAI, Anthropic, Gemini, Ollama —
docs/ai-service.md), each with its own native tool/function-calling wire format: OpenAI's `tools`
array with JSON-schema parameters, Anthropic's `tool_use` content blocks, Gemini's
`functionDeclarations`, and Ollama's own (partial, model-dependent) tool support. `packages/ai`'s
`AIProvider.generate()`/`.stream()` take a single provider-agnostic `GenerateInput`:

```ts
export interface GenerateInput {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}
```

There is no `tools` field. Adding native function calling would mean teaching the Prompt Builder (or
each provider implementation) four different request/response shapes for tool definitions and tool
results, undermining "Prompt Builder must remain provider-independent" — a principle already load
bearing for how conversation history is spliced into messages (docs/rag.md). Instead, the tool
"protocol" is plain text embedded in `messages[].content`: the model is instructed (in prose, by the
system prompt) to emit a specific marker line when it wants a tool, and the pipeline parses that line
back out with a regex. No provider-specific code exists anywhere in this feature — the exact same
marker convention works unmodified against all four providers, because from each provider's
perspective it's just an ordinary chat turn.

## The marker syntax

The instruction the model is given (`TOOL_INSTRUCTIONS`, `rag-pipeline.service.ts`) spells out the
exact format and the full tool list:

```ts
const TOOL_INSTRUCTIONS = [
  'You may call one read-only tool per turn if you need more information before answering.',
  'To do so, reply with ONLY a single line in this exact form: <<TOOL:name>>{"arg":"value"}',
  'Available tools: search{"query"}, graph{"entityId"}, timeline{"entityId"}, documents{"documentId"}, projects{"query"}, meetings{"query"}, customers{"query"}, emails{"query"}, analytics{}.',
  'Do not call a tool if the Context above already answers the question.',
  'When you have enough information, answer in prose, citing sources with their [ref] markers exactly as given.',
].join(' ');
```

`tool-calling.service.ts` parses exactly that shape with one regex:

```ts
const TOOL_MARKER = /<<TOOL:([a-zA-Z]+)>>\s*(\{[^\n]*\})/;

/** Scans a (non-streamed) planning turn for a single tool-call marker. Malformed markers (unknown tool name, invalid JSON) are treated as "no tool call" — the text is used as the final answer rather than crashing the pipeline. */
export function parseToolCall(text: string): ToolCall | null {
  const match = TOOL_MARKER.exec(text);
  if (!match) return null;

  const [, toolName, argsJson] = match;
  if (!toolName || !isToolName(toolName)) return null;

  try {
    const args = JSON.parse(argsJson!) as Record<string, unknown>;
    return { tool: toolName, args };
  } catch {
    return null;
  }
}
```

Both failure modes fail closed into "no tool call, use this text as the answer": an unrecognized tool
name (`isToolName` checks membership in the fixed `TOOL_NAMES` tuple) or invalid JSON in the args
object both return `null`, not a thrown error — a malformed marker can never crash the pipeline, it
just means the model's text is treated as its final prose answer instead.

A companion function strips a recognized marker back out of a planning turn's text, so any prose the
model wrote around it doesn't leak into the tool-result exchange the next turn sees:

```ts
/** Strips a recognized tool-call marker out of a planning turn's text, so any prose the model wrote around it doesn't leak into the tool-result exchange. */
export function stripToolCall(text: string): string {
  return text.replace(TOOL_MARKER, '').trim();
}
```

## The 9 tools

```ts
export const TOOL_NAMES = [
  'search', 'graph', 'timeline', 'documents', 'projects',
  'meetings', 'customers', 'emails', 'analytics',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
```

Every one of the 9 dispatches, unmodified, to a service that already existed before Phase 5 and is
already read-only by name (`list*`/`get*`/`retrieve`) and already org-scoped:

| Marker | Args | Calls | Existing service |
|---|---|---|---|
| `search` | `{"query"}` | `retrieve(organizationId, query, { limit: 10 })` | `retrieval.service.ts` — Phase 4 Hybrid Search (docs/retrieval.md) |
| `graph` | `{"entityId"}` | `getNeighbors(entityId, organizationId)` | `@bond-os/database` graph repository — Phase 3 knowledge graph (docs/knowledge-graph.md) |
| `timeline` | `{"entityId"}` | `getTimeline(entityId, { organizationId, page: 1, pageSize: 10 })` | `@bond-os/database` timeline repository (docs/timeline.md) |
| `documents` | `{"documentId"}` | `getDocumentRetrievalInfoService(organizationId, knowledgeDocumentId)` | `retrieval/services/document-info.service.ts` |
| `projects` | `{"query"}` | `listProjectsService(organizationId, { ...LIST_PAGE, search, sortBy: 'createdAt' })` | `projects/services/project.service.ts` |
| `meetings` | `{"query"}` | `listMeetingsService(organizationId, { ...LIST_PAGE, search, sortBy: 'meetingDate' })` | `meetings/services/meeting.service.ts` |
| `customers` | `{"query"}` | `listCustomersService(organizationId, { ...LIST_PAGE, search, sortBy: 'createdAt' })` | `customers/services/customer.service.ts` |
| `emails` | `{"query"}` | `listEmailsService(organizationId, { ...LIST_PAGE, search, sortBy: 'sentAt' })` | `emails/services/email.service.ts` |
| `analytics` | `{}` | `getGraphAnalyticsService(organizationId)` + `getOrganizationMemoryService(organizationId)` (parallel) | `graph/services/graph.service.ts` + `retrieval/services/memory.service.ts` (docs/memory.md) |

`LIST_PAGE` is a shared, fixed page shape (`{ page: 1, pageSize: 10, sortDir: 'desc' }`) — the model
can't request a different page or page size, only a search term. The full switch:

```ts
export async function executeToolCall(organizationId: string, call: ToolCall): Promise<string> {
  switch (call.tool) {
    case 'search': {
      const results = await retrieve(organizationId, stringArg(call.args, 'query'), { limit: 10 });
      return JSON.stringify(results.map((result) => ({ ref: result.key, title: result.title, snippet: result.snippet })));
    }
    case 'graph': {
      const entityId = stringArg(call.args, 'entityId');
      if (!entityId) return JSON.stringify({ error: 'entityId is required.' });
      const neighbors = await getNeighbors(entityId, organizationId);
      return JSON.stringify(neighbors.slice(0, 20));
    }
    case 'timeline': {
      const entityId = stringArg(call.args, 'entityId');
      if (!entityId) return JSON.stringify({ error: 'entityId is required.' });
      const timeline = await getTimeline(entityId, { organizationId, page: 1, pageSize: 10 });
      return JSON.stringify(timeline.items);
    }
    case 'documents': {
      const knowledgeDocumentId = stringArg(call.args, 'documentId');
      if (!knowledgeDocumentId) return JSON.stringify({ error: 'documentId is required.' });
      const info = await getDocumentRetrievalInfoService(organizationId, knowledgeDocumentId);
      return JSON.stringify(info);
    }
    case 'projects': {
      const search = stringArg(call.args, 'query') || undefined;
      const results = await listProjectsService(organizationId, { ...LIST_PAGE, search, sortBy: 'createdAt' });
      return JSON.stringify(results.items);
    }
    case 'meetings': {
      const search = stringArg(call.args, 'query') || undefined;
      const results = await listMeetingsService(organizationId, { ...LIST_PAGE, search, sortBy: 'meetingDate' });
      return JSON.stringify(results.items);
    }
    case 'customers': {
      const search = stringArg(call.args, 'query') || undefined;
      const results = await listCustomersService(organizationId, { ...LIST_PAGE, search, sortBy: 'createdAt' });
      return JSON.stringify(results.items);
    }
    case 'emails': {
      const search = stringArg(call.args, 'query') || undefined;
      const results = await listEmailsService(organizationId, { ...LIST_PAGE, search, sortBy: 'sentAt' });
      return JSON.stringify(results.items);
    }
    case 'analytics': {
      const [graphAnalytics, orgMemory] = await Promise.all([
        getGraphAnalyticsService(organizationId),
        getOrganizationMemoryService(organizationId),
      ]);
      return JSON.stringify({ graphAnalytics, orgMemory });
    }
    default: {
      const exhaustive: never = call.tool;
      return JSON.stringify({ error: `Unknown tool: ${String(exhaustive)}` });
    }
  }
}
```

The result string, whatever it is, is fed back to the model as an ordinary chat turn — see the
bounded loop below — never executed, never interpreted as further instructions by the tool-dispatch
code itself.

## Why there is no code path from a tool call to a write operation

This is deliberately not framed as "the model is told not to write things" — it's a structural
property of `executeToolCall`'s code, independent of what any prompt says:

1. **`call.tool` is typed, not a free string.** `ToolCall.tool: ToolName`, and `ToolName` is `(typeof
   TOOL_NAMES)[number]` — a union of exactly 9 string literals. `parseToolCall` only ever produces a
   `ToolCall` after `isToolName(toolName)` passes, so nothing outside those 9 literal values can ever
   reach the switch, regardless of what text a model (or an attacker via prompt injection in
   retrieved content, docs/rag.md) puts inside a `<<TOOL:...>>` marker.
2. **The switch is exhaustive and hardcoded, not table-driven.** There is no `Record<string,
   Function>` map keyed by tool name that a new entry could be added to at runtime, and no
   `eval`/dynamic-import/reflection-based dispatch. Each of the 9 `case` branches is a literal,
   fixed call to one specific, already-existing function — the branch a given tool name reaches is
   decided by the TypeScript compiler at build time, not computed from the tool name at runtime.
   The `default` branch makes this exhaustiveness a compile-time guarantee: `const exhaustive: never
   = call.tool` fails to typecheck the moment `TOOL_NAMES` grows without a matching new `case` being
   added — so it is not possible to add a 10th tool (write or otherwise) without a source change to
   this file that a reviewer would see.
3. **Every function the 9 branches call is a pre-existing read.** `retrieve`, `getNeighbors`,
   `getTimeline`, `getDocumentRetrievalInfoService`, `listProjectsService`, `listMeetingsService`,
   `listCustomersService`, `listEmailsService`, `getGraphAnalyticsService`,
   `getOrganizationMemoryService` — every one of these is a `list*`/`get*`/`retrieve` function that
   existed before Phase 5 for an unrelated purpose (the Phase 1-4 UI, or Phase 4 retrieval) and
   returns data, never a `create*`/`update*`/`delete*` function. `tool-calling.service.ts` imports
   none of the mutation services that exist elsewhere in the codebase (e.g.
   `createProjectService`/`updateProjectService`) — there is nothing importable from this file's
   import list that could perform a write even if the switch's structure were somehow subverted.

Put together: to make a tool call ever cause a write, someone would have to edit
`tool-calling.service.ts` itself — add a new literal to `TOOL_NAMES`, add a matching `case`, and
import and call a mutation service inside it. That's a source-code change subject to normal review,
not something reachable by any input a user or an injected document could ever supply through the
marker syntax. This is why the file's own doc comment can say "there is no code path from a tool call
to any write operation, which is the actual mechanism behind 'NO write operations,' not just a prompt
instruction" — the `TOOL_INSTRUCTIONS` telling the model "read-only tool" is reinforcement, not the
safety mechanism itself.

As one further layer, `organizationId` is threaded into every branch even though it's already
present in the calling context, because "every callee already enforces its own
`requireRole`/org-scoping, matching the rest of this codebase's convention of never trusting a
caller's pre-check alone" (the function's own doc comment) — so even a correctly-dispatched read
still can't cross an organization boundary.

## The bounded loop

`BOND_MAX_TOOL_CALLS` (`packages/shared/src/env.ts`) caps how many planning turns a single answer can
spend calling tools:

```ts
// Phase 5 — Mr. Bond AI Copilot. Both have working zero-config defaults —
// Mr. Bond runs with neither set.
BOND_MAX_TOOL_CALLS: z.coerce.number().int().min(0).max(10).default(3),
```

Default `3`, configurable `0`-`10`. `runBondChatPipeline` reads it once per request and only wires up
the tool-calling machinery at all when it's greater than zero:

```ts
let messages: ChatMessage[] = [...built.messages];
const maxToolCalls = getEnv().BOND_MAX_TOOL_CALLS;
let toolCallsUsed = 0;

if (maxToolCalls > 0) {
  messages = [messages[0]!, { role: 'system', content: TOOL_INSTRUCTIONS }, ...messages.slice(1)];

  while (toolCallsUsed < maxToolCalls) {
    yield { type: 'status', stage: 'planning', detail: { attempt: toolCallsUsed + 1 } };

    const plan = await provider.generate({
      model: config.model,
      messages,
      temperature: 0,
      maxTokens: config.maxTokens,
    });

    const toolCall = parseToolCall(plan.content);
    if (!toolCall) break;

    yield { type: 'status', stage: 'tool_call', detail: { tool: toolCall.tool } };

    const toolResult = await executeToolCall(organizationId, toolCall);
    messages.push({ role: 'assistant', content: plan.content });
    messages.push({ role: 'user', content: `Tool result for ${toolCall.tool}:\n${toolResult}` });
    toolCallsUsed += 1;
  }

  if (toolCallsUsed >= maxToolCalls) {
    messages.push({ role: 'system', content: NO_MORE_TOOLS_NOTICE });
  }
}
```

Setting `BOND_MAX_TOOL_CALLS=0` disables tool calling entirely — the `TOOL_INSTRUCTIONS` system
message is never even added to `messages`, so the model is never told tools exist. Otherwise the loop
runs at most `maxToolCalls` iterations; each one either finds a tool call and appends two more
messages (the model's own marker turn, then the tool's JSON result as a `user` turn) and keeps going,
or finds no marker and `break`s straight to the final answer stage. If the loop runs out of
iterations without the model ever giving a plain-text answer, one more system message
(`NO_MORE_TOOLS_NOTICE`, "No more tool calls are available. Answer now using only the information
already gathered.") is appended before falling through to the final turn — the loop can never spin
forever waiting for a tool-free response.

## Planning turns are non-streamed; only the final turn streams

Every planning-turn call uses `provider.generate()` — a single `Promise<GenerateResult>`, not
`provider.stream()`:

```ts
const plan = await provider.generate({
  model: config.model,
  messages,
  temperature: 0,
  maxTokens: config.maxTokens,
});
```

Two deliberate reasons a planning turn can't be a streamed call:

- **The marker has to be parsed as a whole.** `parseToolCall`'s regex needs the complete `<<TOOL:
  name>>{"arg":"value"}` line in one string. A streamed response arrives as arbitrary token-sized
  chunks that could split that marker anywhere — mid-tool-name, mid-JSON — so there's no reliable
  point during a stream at which the marker is guaranteed to be regex-matchable. `generate()`
  returns the full `plan.content` in one shot, so parsing is a single synchronous call.
- **The user should never see a raw marker line.** If a planning turn's tokens were streamed to the
  client the way the final answer's are, the UI would flash `<<TOOL:search>>{"query":"..."}` at the
  user before the pipeline had a chance to intercept and strip it. Keeping every planning turn
  non-streamed means only fully-formed, already-tool-free content ever reaches the client.

`temperature: 0` on every planning call is also deliberate — planning ("should I call a tool, and
which one") is meant to be as deterministic as the provider allows, unlike the final answer, which
uses the org's actual configured `temperature`/`topP`.

Only once the loop exits — either a turn returned no tool marker, or the cap was hit and
`NO_MORE_TOOLS_NOTICE` was appended — does the pipeline call `provider.stream()`, exactly once, for
the turn whose tokens are actually yielded to the client as `{ type: 'token' }` events:

```ts
yield { type: 'status', stage: 'generating' };

let finalContent = '';
for await (const chunk of provider.stream({
  model: config.model,
  messages,
  temperature: config.temperature,
  maxTokens: config.maxTokens,
  topP: config.topP,
})) {
  finalContent += chunk;
  yield { type: 'token', text: chunk };
}
```

So a single answer makes at most `maxToolCalls + 1` calls to the AI provider: up to `maxToolCalls`
non-streamed `generate()` planning turns, followed by exactly one streamed `stream()` turn. The
`BondStreamEvent` stages the client sees (`planning`, `tool_call`, `generating` —
`apps/web/features/bond/lib/stream-events.ts`) map directly onto this structure, so a chat UI can
show "Mr. Bond is looking something up..." during planning turns and only render live tokens once
`generating` starts.

## What's deliberately not built

- **No write tools.** All 9 tools call `list*`/`get*`/`retrieve` functions; none of the create,
  update, or delete services that exist elsewhere in the codebase are imported into
  `tool-calling.service.ts` — see "Why there is no code path from a tool call to a write operation"
  above for the structural (not just instructional) reason.
- **No native per-provider function calling.** `GenerateInput` has no `tools` field; the marker
  convention is the entire tool-calling wire format, and it's identical across all four providers.
- **No autonomous agent loop.** The loop is bounded (`BOND_MAX_TOOL_CALLS`, default 3, hard max 10)
  and strictly sequential — one tool call per planning turn, no parallel tool calls, no tool calling
  a tool. It always terminates, either because the model stops asking for tools or because the cap
  forces a final answer.
- **No multi-agent orchestration.** One model, one conversation, one linear sequence of
  generate-then-maybe-tool turns followed by one stream turn — no sub-agents, no delegation, no
  agent-to-agent messaging.
- **No dynamic or admin-configurable tool registry.** `TOOL_NAMES` is a compile-time constant tuple;
  adding, removing, or reconfiguring a tool requires a code change to this file, not a runtime
  setting.
- **No tool call inside a tool result.** Tool results are appended as plain `user`-role messages fed
  back to the next planning turn — the model can choose to call another tool next iteration (up to
  the cap), but nothing in `executeToolCall` itself is capable of triggering a further tool call.
