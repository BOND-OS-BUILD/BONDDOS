'use client';

import type { AgentChatInput } from '@bond-os/shared';

import type { BondCitation } from '@/features/bond/lib/stream-events';

import type { AgentStreamEvent } from './agent-message';

/**
 * Callbacks invoked once per `AgentStreamEvent` frame as `streamAgentChat`
 * reads them off the wire, named after the event's `type` — mirrors
 * `use-bond-chat.ts`'s `BondChatCallbacks` exactly, except every variant
 * (other than `onDone`/`onActionProposed`/`onError`, which already carry
 * `agentKey` on their event object) also hands back the speaking agent's
 * `agentKey` as a separate argument, since which agent is actually
 * answering matters once more than one can respond in a turn (see
 * `agent-message.ts`). All optional so a caller only wires up what it
 * cares about.
 */
export interface AgentChatCallbacks {
  onStatus?: (
    stage: Extract<AgentStreamEvent, { type: 'status' }>['stage'],
    agentKey: string,
    detail?: Record<string, unknown>,
  ) => void;
  onToken?: (text: string, agentKey: string) => void;
  onCitations?: (citations: BondCitation[], agentKey: string) => void;
  onSuggestions?: (questions: string[], agentKey: string) => void;
  onDone?: (event: Extract<AgentStreamEvent, { type: 'done' }>) => void;
  /** A write plan was proposed (Phase 6) — the turn ends here, no `token`/`done` events follow in this same request. */
  onActionProposed?: (event: Extract<AgentStreamEvent, { type: 'action_proposed' }>) => void;
  onError?: (message: string) => void;
}

/**
 * POSTs `input` to `/api/agents/chat` and streams the SSE response, invoking
 * the matching `callbacks.on*` for every `AgentStreamEvent` frame as it
 * arrives — the agent-layer analogue of `use-bond-chat.ts`'s
 * `streamBondChat`, same wire format (`createSseStream` backs both routes).
 * Never throws — request failures (non-OK response, network error) and
 * in-stream `{ type: 'error' }` events both resolve through
 * `callbacks.onError`, so callers don't need their own try/catch. One
 * request per call; call again for the next turn.
 */
export async function streamAgentChat(
  input: AgentChatInput,
  callbacks: AgentChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/agents/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    callbacks.onError?.('Could not reach the server. Check your connection and try again.');
    return;
  }

  if (!response.ok || !response.body) {
    let message = `Request failed with status ${response.status}.`;
    try {
      const body: unknown = await response.json();
      const parsedMessage = (body as { error?: { message?: string } } | null)?.error?.message;
      if (parsedMessage) message = parsedMessage;
    } catch {
      // Not JSON (or no body) — fall back to the generic message above.
    }
    callbacks.onError?.(message);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        dispatchFrame(frame, callbacks);
        separatorIndex = buffer.indexOf('\n\n');
      }
    }
    // A final frame with no trailing "\n\n" (stream closed right after it).
    if (buffer.trim().length > 0) {
      dispatchFrame(buffer, callbacks);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    callbacks.onError?.('The connection was interrupted before the response finished.');
  } finally {
    reader.releaseLock();
  }
}

function dispatchFrame(frame: string, callbacks: AgentChatCallbacks): void {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) return;

  const json = dataLine.slice('data: '.length);
  if (!json) return;

  let event: AgentStreamEvent;
  try {
    event = JSON.parse(json) as AgentStreamEvent;
  } catch {
    return;
  }

  switch (event.type) {
    case 'status':
      callbacks.onStatus?.(event.stage, event.agentKey, event.detail);
      return;
    case 'token':
      callbacks.onToken?.(event.text, event.agentKey);
      return;
    case 'citations':
      callbacks.onCitations?.(event.citations, event.agentKey);
      return;
    case 'suggestions':
      callbacks.onSuggestions?.(event.questions, event.agentKey);
      return;
    case 'done':
      callbacks.onDone?.(event);
      return;
    case 'action_proposed':
      callbacks.onActionProposed?.(event);
      return;
    case 'error':
      callbacks.onError?.(event.message);
      return;
    default: {
      // Exhaustiveness guard: a switch with no `default` doesn't error at
      // compile time on a missing case (this function returns `void`), so
      // this branch is what actually catches "a new AgentStreamEvent variant
      // was added but this dispatcher wasn't updated" — same as
      // use-bond-chat.ts's dispatchFrame.
      const exhaustive: never = event;
      void exhaustive;
    }
  }
}
