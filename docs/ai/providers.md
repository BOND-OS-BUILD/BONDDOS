# AI Providers (Generation)

## Scope

`packages/ai` is BOND OS's **text-generation** provider abstraction — one interface, four real
REST-backed implementations (OpenAI, Anthropic, Gemini, Ollama), a pure factory, and a shared
tokenizer. It is a distinct package and a distinct provider-id space from `packages/embeddings`
(the vector/embedding side — see [Embeddings](./embeddings.md)); the two share only the `OLLAMA`
provider id and the general shape of "interface + registry + composition root."

This doc covers `packages/ai` itself and its app-layer composition root
(`apps/web/features/ai/services/ai-provider.service.ts`, `ai.service.ts`). For **how a specific
model/provider gets chosen for a given request** (org settings vs. per-message override vs. env
default), see [Model Selection](./model-selection.md). For how the model is actually driven through
a multi-turn tool-calling loop, see [Tool Calling](./tool-calling.md).

## A note on staleness in the source itself

`packages/ai/src/types.ts`'s own doc comment on the `AIProvider` interface, and `docs/ai-service.md`
(the Phase 4 doc this file supersedes), both say, verbatim:

> "Nothing in BOND OS calls `generate()`/`stream()` this phase (no chat, no agents) — only
> `countTokens()` ... and `listModels()`/`health()` ... are actually invoked."

That was accurate when Phase 4 shipped `packages/ai` with no caller yet. **It is no longer true.**
Two real, wired call sites exist today:

- `apps/web/features/bond/services/rag-pipeline.service.ts` — Mr. Bond's chat pipeline calls
  `provider.generate()` on every tool-planning turn and `provider.stream()` exactly once per answer.
- `apps/web/features/agents/services/agent-pipeline.service.ts` — the shared multi-agent reasoning
  loop (`runThinkLoop`) calls the identical two methods, plus a third call site,
  `runSummarize()`, which uses `provider.generate()` to reconcile multiple agents' answers.

`packages/shared/src/env.ts`'s comment on `AI_PROVIDER` repeats the same "since nothing calls
generate()/stream() this phase anyway" reasoning for why the var has no zero-config default — the
*conclusion* (no default) is still correct and deliberate, but the *reasoning* is stale documentation
left over from Phase 4, not a description of current behavior. Both call sites are covered in
[Model Selection](./model-selection.md) and [Tool Calling](./tool-calling.md).

## The `AIProvider` interface

`packages/ai/src/types.ts`:

```ts
export type AIProviderId = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OLLAMA';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateInput {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface GenerateResult {
  content: string;
  model: string;
  finishReason: string;
  usage: TokenUsage; // { promptTokens, completionTokens, totalTokens }
}

export interface AIProvider {
  generate(input: GenerateInput): Promise<GenerateResult>;
  stream(input: GenerateInput): AsyncIterable<string>;
  countTokens(text: string): number;
  listModels(): Promise<ModelInfo[]>;
  health(): Promise<HealthStatus>;
}
```

Four properties of this shape are load-bearing for everything downstream:

- **`ChatMessage.role` has no `'tool'` value.** There is no first-class "tool result" message role
  anywhere in the type system. A tool's result is fed back to the model as an ordinary `user`-role
  turn (see [Tool Calling](./tool-calling.md)) — a deliberate simplification, not an oversight.
- **`GenerateInput` has no `tools` field.** This is the structural reason BOND OS's tool-calling is a
  prompt-marker convention rather than each provider's native function-calling wire format — see
  [Tool Calling](./tool-calling.md) for the full rationale.
- **`stream()` returns `AsyncIterable<string>`, not a richer streamed-`GenerateResult`.** There is no
  way to read a token-usage object back from a streamed call — only `generate()`'s
  `Promise<GenerateResult>` carries `usage`. The chat pipeline's own token accounting for a streamed
  final answer is therefore computed locally via `countTokens()`, never read from the provider — see
  [Model Selection](./model-selection.md#token-accounting-is-a-local-approximation-not-provider-reported-usage).
- **`AIProviderError`** wraps every non-2xx/parse failure with a provider-tagged message
  (`` `${provider} AI provider error: ${message}` ``) and preserves the original `cause`.

## `BaseAIProvider` — shared token counting

`packages/ai/src/base-provider.ts`:

```ts
export abstract class BaseAIProvider implements AIProvider {
  abstract generate(input: GenerateInput): Promise<GenerateResult>;
  abstract stream(input: GenerateInput): AsyncIterable<string>;
  abstract listModels(): Promise<ModelInfo[]>;
  abstract health(): Promise<HealthStatus>;

  countTokens(text: string): number {
    return countTokens(text);
  }
}
```

Every concrete provider extends this and inherits `countTokens()` — none reimplements it. It
delegates to the package's own tokenizer (`packages/ai/src/tokenizer.ts`):

```ts
import { encode } from 'gpt-tokenizer';

export function countTokens(text: string): number {
  return encode(text).length;
}
```

This is `gpt-tokenizer`'s `cl100k_base` encoding — a real BPE tokenizer, not a `text.length / 4`
heuristic. **Caveat, stated plainly (matches the source's own comment):** `cl100k_base` is OpenAI's
encoding. Claude and Gemini use their own tokenizers internally and will count an identical string
slightly differently. `countTokens()` is a close, consistent approximation used uniformly for
budgeting — most importantly the [Context Builder](./context-builder.md)'s token budget, which
needs an accurate count regardless of which (or whether any) `AI_PROVIDER` is configured. It is
never represented as an exact count for every provider.

`countTokens()` is also exposed standalone, provider-independent, via
`apps/web/features/ai/services/ai.service.ts`'s `countTokensService()` — no org check, no provider
instance needed, a pure pass-through the Context Builder calls freely even when `AI_PROVIDER` is
completely unset.

## `createAIProvider` — a pure factory, no local fallback

`packages/ai/src/registry.ts`:

```ts
export interface AIRegistryConfig {
  provider: AIProviderId;
  openai?: { apiKey: string; baseUrl?: string };
  anthropic?: { apiKey: string; baseUrl?: string };
  gemini?: { apiKey: string; baseUrl?: string };
  ollama?: { baseUrl?: string };
}

export function createAIProvider(config: AIRegistryConfig): AIProvider {
  switch (config.provider) {
    case 'OPENAI':
      if (!config.openai?.apiKey) throw new Error('AI_PROVIDER=OPENAI requires OPENAI_API_KEY.');
      return new OpenAiProvider(config.openai);
    case 'ANTHROPIC':
      if (!config.anthropic?.apiKey) throw new Error('AI_PROVIDER=ANTHROPIC requires ANTHROPIC_API_KEY.');
      return new AnthropicProvider(config.anthropic);
    case 'GEMINI':
      if (!config.gemini?.apiKey) throw new Error('AI_PROVIDER=GEMINI requires GEMINI_API_KEY.');
      return new GeminiAiProvider(config.gemini);
    case 'OLLAMA':
      return new OllamaAiProvider(config.ollama);
    default:
      throw new Error(`Unknown AI provider: ${String(config.provider)}`);
  }
}
```

Two design points, both stated directly in the source's own comment:

- **Pure factory, no env-var reading.** Same reasoning as `@bond-os/embeddings`'s
  `createEmbeddingProvider` — keeps the package dependency-free; the app layer composes it with
  `getEnv()` (see [Composition root](#composition-root-appswebfeaturesaiservicesai-providerservicets)
  below).
- **No local/"none" fallback for generation, by design — unlike embeddings.** `packages/embeddings`
  has `LocalHashEmbeddingProvider` as a zero-config default (see [Embeddings](./embeddings.md)); a
  deterministic hash-based vector is a legitimate, if low-quality, embedding. Text generation has no
  equivalent: "a fake generator returning placeholder text would be actively misleading, not a useful
  default." An unconfigured provider throws immediately rather than silently degrading; callers that
  need graceful "not configured" UI check configuration first (see
  [`isAIProviderConfigured`](#composition-root-appswebfeaturesaiservicesai-providerservicets) below),
  not by catching the throw.

## `stream-utils.ts` — the shared streaming primitive

`packages/ai/src/stream-utils.ts` factors out the one thing every provider's streaming
implementation needs, so line-buffering logic isn't duplicated four times:

```ts
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  // decodes chunks, buffers, yields complete trimmed non-empty lines
}

export function parseSseData(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice('data:'.length).trim();
  if (payload === '[DONE]') return null;
  return payload;
}

export async function safeResponseText(response: Response): Promise<string> {
  return response.text().catch(() => response.statusText);
}
```

OpenAI, Anthropic, and Gemini all stream Server-Sent Events (`data: {...}`, terminated by an
`event:`/comment line or a `[DONE]` sentinel); Ollama streams NDJSON — one bare JSON object per
line, no `data:` prefix, no sentinel at all. The three SSE providers call `readLines()` then
`parseSseData()` before `JSON.parse`-ing the payload; Ollama calls `readLines()` and parses each
line directly. `safeResponseText()` gives every provider's error path a best-effort response body
even if `.text()` itself throws.

## The four providers

All four are real, complete `fetch`-based REST clients — none is a stub or a mock. Whether any is
*usable at runtime* is a separate question of configuration (see
[Configuration and readiness](#configuration-and-readiness) below).

| Provider | `generate()` / `stream()` endpoint | `listModels()` endpoint | Auth | Streaming wire format | Default base URL |
|---|---|---|---|---|---|
| `OpenAiProvider` (`openai.ts`) | `POST {baseUrl}/chat/completions` | `GET {baseUrl}/models` | `Authorization: Bearer {apiKey}` | SSE (`data: {...}`) | `https://api.openai.com/v1` |
| `AnthropicProvider` (`anthropic.ts`) | `POST {baseUrl}/messages` | `GET {baseUrl}/models` | `x-api-key` + `anthropic-version` header (default `2023-06-01`) | SSE, filters `content_block_delta` / `text_delta` events | `https://api.anthropic.com/v1` |
| `GeminiAiProvider` (`gemini.ts`) | `POST {baseUrl}/models/{model}:generateContent?key=...` / `:streamGenerateContent?alt=sse&key=...` | `GET {baseUrl}/models?key=...` | API key as query param | SSE | `https://generativelanguage.googleapis.com/v1beta` |
| `OllamaAiProvider` (`ollama.ts`) | `POST {baseUrl}/api/chat` | `GET {baseUrl}/api/tags` | none | **NDJSON**, one bare JSON object per line | `http://localhost:11434` |

Provider-specific shaping, each confirmed by reading the file:

- **OpenAI** — request body maps `GenerateInput` fields nearly 1:1 (`temperature`, `max_tokens`,
  `top_p`, `stream`). `generate()` throws `AIProviderError('openai', ...)` on a non-2xx response or
  an empty `choices` array. `listModels()` maps `{id}` straight through (`name: model.id` — the API
  doesn't return a separate display name).
- **Anthropic** — `system`-role messages are **hoisted out of `messages`** into a top-level `system`
  string before the request is built (`input.messages.filter(role === 'system').map(...).join('\n\n')`),
  because the Messages API takes `system` as its own top-level field, not a message in the array.
  `max_tokens` defaults to `1024` (`DEFAULT_MAX_TOKENS`) if `GenerateInput.maxTokens` is unset — the
  Anthropic API requires `max_tokens`, unlike OpenAI/Gemini/Ollama, where it's optional.
  `apiVersion` defaults to `2023-06-01` and is configurable.
- **Gemini** — `assistant` role is remapped to Gemini's own `model` role (`toContents()`); `system`
  messages become a separate `systemInstruction` object (`toSystemInstruction()`), matching Gemini's
  request shape. The streaming endpoint is a *different URL suffix*
  (`:streamGenerateContent?alt=sse`) from the non-streaming one (`:generateContent`), not a query
  flag on the same endpoint.
- **Ollama** — the only provider with **no auth header at all** (no API key concept for a local
  server) and the only one using NDJSON instead of SSE. `generate()`'s token usage comes from
  `prompt_eval_count` / `eval_count` in the response, defaulting to `0` if either is absent (a local
  model's response doesn't always populate these).

All four implement `health()` identically — time a `listModels()` call, return
`{ healthy: true, latencyMs }` on success or `{ healthy: false, message }` on any thrown error. None
does a lighter-weight ping; a health check is a real API call.

## Composition root: `apps/web/features/ai/services/ai-provider.service.ts`

This is the one place `packages/ai`'s pure factory meets `getEnv()`:

```ts
export function isAIProviderIdConfigured(providerId: AIProviderId): boolean {
  switch (providerId) {
    case 'OPENAI': return Boolean(env.OPENAI_API_KEY);
    case 'ANTHROPIC': return Boolean(env.ANTHROPIC_API_KEY);
    case 'GEMINI': return Boolean(env.GEMINI_API_KEY);
    case 'OLLAMA': return true; // no key needed
  }
}

export function isAIProviderConfigured(): boolean {
  const env = getEnv();
  if (!env.AI_PROVIDER) return false;
  return isAIProviderIdConfigured(env.AI_PROVIDER);
}

const providerCache = new Map<AIProviderId, AIProvider>();

export function getAIProviderById(providerId: AIProviderId): AIProvider {
  const cached = providerCache.get(providerId);
  if (cached) return cached;
  if (!isAIProviderIdConfigured(providerId)) throw new Error(`AI provider "${providerId}" is not configured.`);
  const created = createAIProvider({ provider: providerId, /* keys from getEnv() */ });
  providerCache.set(providerId, created);
  return created;
}

export function getAIProvider(): AIProvider {
  const env = getEnv();
  if (!env.AI_PROVIDER) throw new Error('No AI_PROVIDER configured.');
  return getAIProviderById(env.AI_PROVIDER);
}
```

Two things worth being precise about:

- **`getAIProviderById` and `getAIProvider` share the same `providerCache` Map.** `getAIProvider()`
  (the original, env-driven path used by the AI Configuration / health-check UI) is implemented as a
  thin call into `getAIProviderById(env.AI_PROVIDER)`. Resolving the same provider id through either
  entry point returns the identical cached instance — one `AIProvider` object per `AIProviderId` for
  the lifetime of the process, not per-org.
- **`getAIProviderById` is the per-org-override path** — added so [Model Selection](./model-selection.md)'s
  `OrganizationAiSettings.provider` override can resolve a provider that may differ from
  `env.AI_PROVIDER`, without disturbing `getAIProvider()`'s own behavior for its existing callers.

`getActiveModelLabel()` is just `env.AI_MODEL || null` — a label for UI display, **not validated
against `listModels()`**.

## The org-scoped, audit-logged surface: `apps/web/features/ai/services/ai.service.ts`

The layer the UI and other services actually call, wrapping the composition root with
`requireRole`/audit logging:

| Function | Role | Behavior |
|---|---|---|
| `getModelManagementInfoService(organizationId)` | MEMBER | Returns provider/model/embedding config + configured booleans, for the AI Configuration page. |
| `listAIModelsService(organizationId)` | MEMBER | Returns `[]` (**not an error**) if unconfigured — the Models page renders an empty/"not configured" state, not a crash. Otherwise calls `provider.listModels()` and logs one `AiAuditLog` row (`action: 'ai.list_models'`). |
| `getAIHealthService(organizationId)` | MEMBER | Returns `{ healthy: false, configured: false, message: 'No AI provider configured.' }` if unconfigured; otherwise `provider.health()` with `configured: true` merged in. |
| `countTokensService(text)` | none | No org check, no provider instance — pure `countTokens()` pass-through. |
| `getAiAuditStatsService(organizationId)` | MEMBER | Aggregate counts from `AiAuditLog`. |

## Configuration and readiness

`AI_PROVIDER` (`packages/shared/src/env.ts`) has **no default** — it is left `undefined` unless an
operator sets it:

```ts
AI_PROVIDER: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA']).optional().or(z.literal(''))
  .transform((value) => (value ? value : undefined)),
```

Concretely: **out of the box, with no env vars set, no generation provider is active.** Both
`getAIProvider()` and `getAIProviderById()` throw rather than silently degrade — `resolveEffectiveAiConfigService`
(see [Model Selection](./model-selection.md)) turns that into a user-facing `ValidationError` before
Mr. Bond or an agent ever reaches the AI provider. An operator activates generation either by setting
`AI_PROVIDER` (+ the matching API key, or nothing extra for `OLLAMA`) at the environment level, or an
org ADMIN sets `OrganizationAiSettings.provider`/`.model` via `PATCH /api/ai/settings` — see
[Model Selection](./model-selection.md).

## Security: no API key is ever persisted or returned

Every provider key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) is read straight from
`process.env` via `getEnv()` and held only in the in-process `providerCache` — there is no
`Connector`-style config row, no database column for a generation API key, nothing written to disk.
`OrganizationAiSettings` (the per-org override row) stores `provider`/`model`/`temperature`/`topP`/
`maxTokens`/`streamingEnabled`/`contextWindow`/`retrievalDepth` — **no API key field at all**; an org
can choose *which* configured provider to use, never supply its own credentials through the UI. The
config surfaces exposed to the client (`AIModelManagementInfo`, `AIHealthResult`) carry only booleans
and labels (`aiProviderConfigured: boolean`, `health.configured: boolean`) — never the key itself.
See [Secrets](../security/secrets.md) for the broader secrets-handling model this fits into.

## What's deliberately not built

- **No native per-provider function/tool calling.** `GenerateInput` has no `tools` field — see
  [Tool Calling](./tool-calling.md) for the marker-based alternative and its rationale.
- **No streamed token usage.** `stream()` returns `AsyncIterable<string>` with no usage object;
  provider-reported usage is only ever available from `generate()`'s `GenerateResult.usage`, and even
  then only for planning turns — the pipeline's final-answer token accounting does not read it (see
  [Model Selection](./model-selection.md)).
- **No provider auto-failover.** If the configured provider errors, the request fails — there is no
  automatic retry against a different `AIProviderId`.
- **No model validation.** Neither `AI_MODEL`, `OrganizationAiSettings.model`, nor the per-message
  Model Selector override is checked against `listModels()` before being sent to the provider.

## Related docs

- [Model Selection](./model-selection.md) — how a provider/model is actually resolved per request.
- [Tool Calling](./tool-calling.md) — the marker-based function-calling loop built on top of
  `generate()`/`stream()`.
- [Embeddings](./embeddings.md) — the separate, five-provider embedding side (`packages/embeddings`).
- [RAG Pipeline](./rag.md) — the end-to-end pipeline that is `packages/ai`'s only real caller today.
- [Secrets](../security/secrets.md) — how provider API keys are handled as secrets generally.
- [AI API](../api/ai.md) — the `/api/ai/*` routes this service layer backs.
