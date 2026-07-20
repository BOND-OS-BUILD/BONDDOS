import { BaseAIProvider } from '../base-provider';
import { readLines, safeResponseText } from '../stream-utils';
import { AIProviderError, type GenerateInput, type GenerateResult, type HealthStatus, type ModelInfo } from '../types';

export interface OllamaAiConfig {
  baseUrl?: string;
}

interface OllamaChatResponse {
  message: { content: string };
  model: string;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

/** Real REST calls to a local Ollama server's `/api/chat` — NDJSON streaming (one JSON object per line), not SSE. */
export class OllamaAiProvider extends BaseAIProvider {
  private readonly baseUrl: string;

  constructor(config: OllamaAiConfig = {}) {
    super();
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
  }

  private body(input: GenerateInput, stream: boolean) {
    return {
      model: input.model,
      messages: input.messages,
      options: { temperature: input.temperature, num_predict: input.maxTokens, top_p: input.topP },
      stream,
    };
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.body(input, false)),
    });
    if (!response.ok) {
      throw new AIProviderError('ollama', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }

    const json = (await response.json()) as OllamaChatResponse;
    const promptTokens = json.prompt_eval_count ?? 0;
    const completionTokens = json.eval_count ?? 0;

    return {
      content: json.message.content,
      model: json.model,
      finishReason: json.done_reason ?? 'stop',
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  }

  async *stream(input: GenerateInput): AsyncIterable<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.body(input, true)),
    });
    if (!response.ok || !response.body) {
      throw new AIProviderError('ollama', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }

    for await (const line of readLines(response.body)) {
      const chunk = JSON.parse(line) as OllamaChatResponse;
      if (chunk.message.content) yield chunk.message.content;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) {
      throw new AIProviderError('ollama', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }
    const json = (await response.json()) as OllamaTagsResponse;
    return json.models.map((model) => ({ id: model.name, name: model.name }));
  }

  async health(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.listModels();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return { healthy: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}
