'use client';

import type { SendBondMessageInput } from '@bond-os/shared';

import type { BondCitation, BondStreamEvent } from './stream-events';

/**
 * Callbacks invoked once per `BondStreamEvent` frame as `streamBondChat`
 * reads them off the wire, named after the event's `type` — see
 * `stream-events.ts` for the exact contract. All optional so a caller only
 * wires up what it cares about.
 */
export interface BondChatCallbacks {
  onStatus?: (stage: Extract<BondStreamEvent, { type: 'status' }>['stage'], detail?: Record<string, unknown>) => void;
  onToken?: (text: string) => void;
  onCitations?: (citations: BondCitation[]) => void;
  onSuggestions?: (questions: string[]) => void;
  onDone?: (event: Extract<BondStreamEvent, { type: 'done' }>) => void;
  /** A write plan was proposed (Phase 6) — the turn ends here, no `token`/`done` events follow in this same request. */
  onActionProposed?: (event: Extract<BondStreamEvent, { type: 'action_proposed' }>) => void;
  onError?: (message: string) => void;
}

/**
 * POSTs `input` to `/api/bond/chat` and streams the SSE response, invoking
 * the matching `callbacks.on*` for every `BondStreamEvent` frame as it
 * arrives. Never throws — request failures (non-OK response, network error)
 * and in-stream `{ type: 'error' }` events both resolve through
 * `callbacks.onError`, so callers don't need their own try/catch. One
 * request per call; call again for the next turn.
 */
export async function streamBondChat(
  input: SendBondMessageInput,
  callbacks: BondChatCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/bond/chat', {
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

function dispatchFrame(frame: string, callbacks: BondChatCallbacks): void {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) return;

  const json = dataLine.slice('data: '.length);
  if (!json) return;

  let event: BondStreamEvent;
  try {
    event = JSON.parse(json) as BondStreamEvent;
  } catch {
    return;
  }

  switch (event.type) {
    case 'status':
      callbacks.onStatus?.(event.stage, event.detail);
      return;
    case 'token':
      callbacks.onToken?.(event.text);
      return;
    case 'citations':
      callbacks.onCitations?.(event.citations);
      return;
    case 'suggestions':
      callbacks.onSuggestions?.(event.questions);
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
      // this branch is what actually catches "a new BondStreamEvent variant
      // was added but this dispatcher wasn't updated" — the same class of
      // gap that let `action_proposed` initially go unhandled here.
      const exhaustive: never = event;
      void exhaustive;
    }
  }
}
