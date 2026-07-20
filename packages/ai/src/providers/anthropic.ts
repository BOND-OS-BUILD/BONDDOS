import { BaseAIProvider } from '../base-provider';
import { parseSseData, readLines, safeResponseText } from '../stream-utils';
import { AIProviderError, type GenerateInput, type GenerateResult, type HealthStatus, type ModelInfo } from '../types';

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
}

const DEFAULT_API_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
}

interface AnthropicModelsResponse {
  data: Array<{ id: string; display_name?: string }>;
}

/** Real REST calls to Anthropic's Messages API. */
export class AnthropicProvider extends BaseAIProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;

  constructor(config: AnthropicConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com/v1';
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.apiVersion,
    };
  }

  private body(input: GenerateInput, stream: boolean) {
    const system = input.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const conversation = input.messages.filter((message) => message.role !== 'system');

    return {
      model: input.model,
      system: system || undefined,
      messages: conversation,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: input.temperature,
      top_p: input.topP,
      stream,
    };
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(input, false)),
    });
    if (!response.ok) {
      throw new AIProviderError('anthropic', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }

    const json = (await response.json()) as AnthropicMessageResponse;
    const text = json.content.find((block) => block.type === 'text')?.text ?? '';

    return {
      content: text,
      model: json.model,
      finishReason: json.stop_reason,
      usage: {
        promptTokens: json.usage.input_tokens,
        completionTokens: json.usage.output_tokens,
        totalTokens: json.usage.input_tokens + json.usage.output_tokens,
      },
    };
  }

  async *stream(input: GenerateInput): AsyncIterable<string> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(input, true)),
    });
    if (!response.ok || !response.body) {
      throw new AIProviderError('anthropic', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }

    for await (const line of readLines(response.body)) {
      const data = parseSseData(line);
      if (!data) continue;
      const event = JSON.parse(data) as AnthropicStreamEvent;
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        yield event.delta.text;
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!response.ok) {
      throw new AIProviderError('anthropic', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }
    const json = (await response.json()) as AnthropicModelsResponse;
    return json.data.map((model) => ({ id: model.id, name: model.display_name ?? model.id }));
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
