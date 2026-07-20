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
  /** Nucleus sampling — optional, provider-independent. Omitted entirely from the request body when unset (not sent as `undefined`), same as `temperature`/`maxTokens` already are per-provider. */
  topP?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GenerateResult {
  content: string;
  model: string;
  finishReason: string;
  usage: TokenUsage;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  latencyMs?: number;
}

/**
 * The generation-provider contract. Nothing in BOND OS calls `generate()`/
 * `stream()` this phase (no chat, no agents) — only `countTokens()` (the
 * Context Builder) and `listModels()`/`health()` (the AI Configuration UI)
 * are actually invoked. The methods are real, working implementations
 * anyway, not stubs — ready for the chat/agent phase that will eventually
 * call them, matching "provider abstraction... no UI yet" literally.
 */
export interface AIProvider {
  generate(input: GenerateInput): Promise<GenerateResult>;
  stream(input: GenerateInput): AsyncIterable<string>;
  countTokens(text: string): number;
  listModels(): Promise<ModelInfo[]>;
  health(): Promise<HealthStatus>;
}

export class AIProviderError extends Error {
  constructor(provider: string, message: string, cause?: unknown) {
    super(`${provider} AI provider error: ${message}`);
    this.name = 'AIProviderError';
    this.cause = cause;
  }
}
