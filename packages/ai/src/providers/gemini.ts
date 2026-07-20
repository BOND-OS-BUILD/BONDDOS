import { BaseAIProvider } from '../base-provider';
import { parseSseData, readLines, safeResponseText } from '../stream-utils';
import {
  AIProviderError,
  type ChatMessage,
  type GenerateInput,
  type GenerateResult,
  type HealthStatus,
  type ModelInfo,
} from '../types';

export interface GeminiAiConfig {
  apiKey: string;
  baseUrl?: string;
}

interface GeminiGenerateResponse {
  candidates: Array<{ content: { parts: Array<{ text?: string }> }; finishReason: string }>;
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
  modelVersion?: string;
}

interface GeminiModelsResponse {
  models: Array<{ name: string; displayName?: string }>;
}

function toContents(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
}

function toSystemInstruction(messages: ChatMessage[]) {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  return system ? { parts: [{ text: system }] } : undefined;
}

/** Real REST calls to Google's Generative Language API (`generateContent`/`streamGenerateContent`). */
export class GeminiAiProvider extends BaseAIProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: GeminiAiConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  private body(input: GenerateInput) {
    return {
      contents: toContents(input.messages),
      systemInstruction: toSystemInstruction(input.messages),
      generationConfig: { temperature: input.temperature, maxOutputTokens: input.maxTokens, topP: input.topP },
    };
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const response = await fetch(`${this.baseUrl}/models/${input.model}:generateContent?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.body(input)),
    });
    if (!response.ok) {
      throw new AIProviderError('gemini', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }

    const json = (await response.json()) as GeminiGenerateResponse;
    const candidate = json.candidates[0];
    if (!candidate) throw new AIProviderError('gemini', 'No candidate returned.');

    return {
      content: candidate.content.parts.map((part) => part.text ?? '').join(''),
      model: json.modelVersion ?? input.model,
      finishReason: candidate.finishReason,
      usage: {
        promptTokens: json.usageMetadata.promptTokenCount,
        completionTokens: json.usageMetadata.candidatesTokenCount,
        totalTokens: json.usageMetadata.totalTokenCount,
      },
    };
  }

  async *stream(input: GenerateInput): AsyncIterable<string> {
    const response = await fetch(
      `${this.baseUrl}/models/${input.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.body(input)),
      },
    );
    if (!response.ok || !response.body) {
      throw new AIProviderError('gemini', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }

    for await (const line of readLines(response.body)) {
      const data = parseSseData(line);
      if (!data) continue;
      const chunk = JSON.parse(data) as GeminiGenerateResponse;
      const text = chunk.candidates[0]?.content.parts.map((part) => part.text ?? '').join('');
      if (text) yield text;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`);
    if (!response.ok) {
      throw new AIProviderError('gemini', `HTTP ${response.status}: ${await safeResponseText(response)}`);
    }
    const json = (await response.json()) as GeminiModelsResponse;
    return json.models.map((model) => ({ id: model.name, name: model.displayName ?? model.name }));
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
