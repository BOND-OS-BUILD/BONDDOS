import { BaseAIProvider } from '../base-provider';
import { parseSseData, readLines, safeResponseText } from '../stream-utils';
import { AIProviderError, type GenerateInput, type GenerateResult, type HealthStatus, type ModelInfo } from '../types';

export interface OpenAiConfig {
  apiKey: string;
  baseUrl?: string;
}

interface OpenAiChatResponse {
  choices: Array<{ message: { content: string }; finish_reason: string }>;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenAiStreamChunk {
  choices: Array<{ delta: { content?: string } }>;
}

interface OpenAiModelsResponse {
  data: Array<{ id: string }>;
}

/** Real REST calls to OpenAI's chat-completions API. */
export class OpenAiProvider extends BaseAIProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: OpenAiConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` };
  }

  private body(input: GenerateInput, stream: boolean) {
    return {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      top_p: input.topP,
      stream,
    };
  }

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

  async *stream(input: GenerateInput): AsyncIterable<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(input, true)),
    });
    if (!response.ok || !response.body) {
      throw new AIProviderError('openai', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }

    for await (const line of readLines(response.body)) {
      const data = parseSseData(line);
      if (!data) continue;
      const chunk = JSON.parse(data) as OpenAiStreamChunk;
      const delta = chunk.choices[0]?.delta.content;
      if (delta) yield delta;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!response.ok) {
      throw new AIProviderError('openai', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }
    const json = (await response.json()) as OpenAiModelsResponse;
    return json.data.map((model) => ({ id: model.id, name: model.id }));
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
