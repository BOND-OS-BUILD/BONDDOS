/**
 * Reads a fetch `Response.body` as a stream of complete, trimmed, non-empty
 * lines — the shared primitive both SSE (`data: {...}`, used by OpenAI/
 * Anthropic/Gemini) and NDJSON (one bare JSON object per line, used by
 * Ollama) streaming formats are built on top of.
 */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) yield line;
        newlineIndex = buffer.indexOf('\n');
      }
    }
    const trailing = buffer.trim();
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

/** Extracts an SSE line's `data:` payload, or null for non-data lines (`event:`, comments, the `[DONE]` sentinel). */
export function parseSseData(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice('data:'.length).trim();
  if (payload === '[DONE]') return null;
  return payload;
}

export async function safeResponseText(response: Response): Promise<string> {
  return response.text().catch(() => response.statusText);
}
