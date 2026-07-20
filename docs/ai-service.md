# AI Service (Generation Provider Abstraction)

## Scope

This phase builds the generation-provider **architecture** — a reusable interface and four real,
working REST-backed implementations — with **no chat UI and no agents**. Nothing in this codebase
actually calls `generate()` or `stream()` this phase; only `listModels()`/`health()` (the AI
Configuration pages) and `countTokens()` (the Context Builder) are ever invoked. That the
generation methods sit unreached behind a real implementation is intentional, not a bug: the spec
asks for "provider abstraction... no UI yet," and the honest reading of that is a working
abstraction with no caller yet, not a stub waiting to be filled in.

## The `AIProvider` interface (`packages/ai/src/types.ts`)

```ts
export interface AIProvider {
  generate(input: GenerateInput): Promise<GenerateResult>;
  stream(input: GenerateInput): AsyncIterable<string>;
  countTokens(text: string): number;
  listModels(): Promise<ModelInfo[]>;
  health(): Promise<HealthStatus>;
}
```

The doc comment on the interface says this plainly:

```ts
/**
 * The generation-provider contract. Nothing in BOND OS calls `generate()`/
 * `stream()` this phase (no chat, no agents) — only `countTokens()` (the
 * Context Builder) and `listModels()`/`health()` (the AI Configuration UI)
 * are actually invoked. The methods are real, working implementations
 * anyway, not stubs — ready for the chat/agent phase that will eventually
 * call them, matching "provider abstraction... no UI yet" literally.
 */
```

## Four real providers (`packages/ai/src/providers/*.ts`)

Every provider is a real `fetch`-based REST client against the vendor's actual chat/generation
API — not a mock, not a `throw new NotImplementedError()`:

- **`OpenAiProvider`** — OpenAI's chat-completions API (`POST /chat/completions`,
  `GET /models`), Bearer-token auth.
- **`AnthropicProvider`** — Anthropic's Messages API (`POST /messages`, `GET /models`),
  `x-api-key` + `anthropic-version` headers, with `system`-role messages hoisted out of
  `messages` into the top-level `system` field the Messages API expects.
- **`GeminiAiProvider`** — Google's Generative Language API
  (`POST /models/{model}:generateContent`, `:streamGenerateContent?alt=sse`), API key as a query
  param, with `assistant` messages remapped to Gemini's `model` role.
- **`OllamaAiProvider`** — a local Ollama server's `/api/chat` and `/api/tags`, no auth, defaulting
  to `http://localhost:11434`.

Each constructor takes only what that provider needs (an API key for the three hosted providers,
just an optional `baseUrl` for Ollama), and each method is a straight HTTP call, e.g. `generate()`
on OpenAI:

```ts
async generate(input: GenerateInput): Promise<GenerateResult> {
  const response = await fetch(`${this.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: this.headers(),
    body: JSON.stringify(this.body(input, false)),
  });
  if (!response.ok) {
    throw new AIProviderError('openai', `HTTP ${response.status}: ${await safeResponseText(response)}`);
  }
  const json = (await response.json()) as OpenAiChatResponse;
  const choice = json.choices[0];
  if (!choice) throw new AIProviderError('openai', 'No completion returned.');
  return {
    content: choice.message.content,
    model: json.model,
    finishReason: choice.finish_reason,
    usage: {
      promptTokens: json.usage.prompt_tokens,
      completionTokens: json.usage.completion_tokens,
      totalTokens: json.usage.total_tokens,
    },
  };
}
```

### Streaming: two wire formats, one shared parser

OpenAI, Anthropic, and Gemini all stream Server-Sent Events (`data: {...}\n\n`, terminated by an
`event:`/comment line or the `[DONE]` sentinel). Ollama streams NDJSON instead — one bare JSON
object per line, no `data:` prefix, no sentinel. Rather than duplicate line-buffering logic in
four providers, `packages/ai/src/stream-utils.ts` factors out the one primitive both formats sit
on top of:

```ts
/**
 * Reads a fetch `Response.body` as a stream of complete, trimmed, non-empty
 * lines — the shared primitive both SSE (`data: {...}`, used by OpenAI/
 * Anthropic/Gemini) and NDJSON (one bare JSON object per line, used by
 * Ollama) streaming formats are built on top of.
 */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  ...
}

/** Extracts an SSE line's `data:` payload, or null for non-data lines (`event:`, comments, the `[DONE]` sentinel). */
export function parseSseData(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice('data:'.length).trim();
  if (payload === '[DONE]') return null;
  return payload;
}
```

The three SSE providers call `readLines()` then `parseSseData()` before `JSON.parse`-ing the
payload; Ollama calls `readLines()` and `JSON.parse`s each line directly, since there's no `data:`
envelope to strip. `safeResponseText()` (also in `stream-utils.ts`) gives every provider's error
path a best-effort response body even when `.text()` itself fails.

## Token counting

`countTokens()` is implemented once, in `BaseAIProvider` (`packages/ai/src/base-provider.ts`), and
every provider inherits it rather than reimplementing it:

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

That delegates to the package's own tokenizer (`packages/ai/src/tokenizer.ts`), which wraps
`gpt-tokenizer`'s `cl100k_base` encoding — a real BPE tokenizer, not a `text.length / 4`
heuristic:

```ts
/**
 * Provider-agnostic token counting (cl100k_base), usable without
 * instantiating any `AIProvider` — the Context Builder needs accurate token
 * budgets regardless of whether an `AI_PROVIDER` is even configured
 * (retrieval/embeddings never require AI generation to be set up).
 */
export function countTokens(text: string): number {
  return encode(text).length;
}
```

**Caveat, stated plainly**: `cl100k_base` is OpenAI's encoding. Claude and Gemini use their own
tokenizers internally and will count the same string slightly differently. `countTokens()` is
therefore a close, consistent approximation used uniformly for budgeting (the Context Builder,
`apps/web/features/retrieval/services/context-builder.service.ts`) — it is not represented as an
exact token count for every provider, and nothing in this phase claims otherwise.

## Why there's no local/"none" fallback provider

`@bond-os/embeddings` has `LocalHashEmbeddingProvider` as a zero-config default — a deterministic
hash-based vector is a legitimate, if low-quality, embedding. Text generation has no equivalent:
a fake generator returning placeholder prose would look like a real answer and mislead whoever
reads it. `packages/ai/src/registry.ts` says so directly:

```ts
/**
 * A pure factory — no env-var reading (same reasoning as
 * `@bond-os/embeddings`'s `createEmbeddingProvider`: keeps this package
 * dependency-free, the app layer composes it with `getEnv()`). Unlike
 * embeddings, there's no sensible "local" fallback for text generation — a
 * fake generator returning placeholder text would be actively misleading,
 * not a useful default — so an unconfigured provider throws immediately
 * rather than silently degrading. Callers that need graceful "not
 * configured" UI (health checks, the AI Settings page) check configuration
 * before calling this, not after catching the throw.
 */
export function createAIProvider(config: AIRegistryConfig): AIProvider {
```

Concretely: `getAIProvider()` (`apps/web/features/ai/services/ai-provider.service.ts`) throws
`'No AI_PROVIDER configured.'` when `AI_PROVIDER` is unset. Every caller that needs to render UI
instead of crashing — `getModelManagementInfoService`, `listAIModelsService`,
`getAIHealthService` in `apps/web/features/ai/services/ai.service.ts` — calls
`isAIProviderConfigured()` first and short-circuits to a "not configured" result (`[]` for models,
`{ healthy: false, configured: false, message: 'No AI provider configured.' }` for health) before
ever touching `getAIProvider()`. The `/ai` and `/ai/models` pages render that as a `Badge` reading
"Not configured" and an `EmptyState`, never a stack trace.

## Environment variables

- **`AI_PROVIDER`** — optional, no default (`OPENAI | ANTHROPIC | GEMINI | OLLAMA`). Left unset in
  `packages/shared/src/env.ts` on purpose: "AI_PROVIDER has no working zero-config default (see
  packages/ai/src/registry.ts's doc comment on why) — left unset/optional here too, since nothing
  calls generate()/stream() this phase anyway."
- **`AI_MODEL`** — the model id used as the "active model" label shown in the AI Settings page;
  not itself validated against `listModels()`.
- **`ANTHROPIC_API_KEY`** — required when `AI_PROVIDER=ANTHROPIC`.
- **`AI_TEMPERATURE`** — default `0.7`.
- **`AI_MAX_TOKENS`** — default `2048`.

`OPENAI_API_KEY` and `GEMINI_API_KEY` are shared with the embeddings provider configuration and
are already documented in `docs/embeddings.md` — see that doc rather than this one for how the
embeddings side of those two keys works.

## Security: no API key is ever persisted or returned

Every key above is read straight from `process.env` via `getEnv()` and held only in the
in-process provider cache in `ai-provider.service.ts` — no `Connector`-style config row, no
database column, nothing written to disk. The config surface exposed to the UI
(`AIModelManagementInfo`, `AIHealthResult`) carries only booleans and labels —
`aiProviderConfigured: boolean`, `health.configured: boolean` — never the key itself; no API route
under `apps/web/app/api/ai/**` serializes a key into a response. This is how "API key encryption"
(Security §15) is satisfied for this phase: there is nothing stored, so there is nothing to
encrypt or leak.

## What's deliberately not built

- No chat UI — `generate()`/`stream()` have no caller anywhere in `apps/web`.
- No agents, no tool/function calling in the `generate()` shape — `GenerateInput` has no `tools`
  field; that's a future phase's concern once there's an agent loop to drive it.
- No workflow automation built on top of generation.
- No multi-turn conversation state — `GenerateInput.messages` is accepted per-call; nothing
  persists a conversation across calls, because nothing calls it yet.
