'use client';

import type { ExecutionStreamEvent } from './execution-stream-events';

/**
 * Callbacks invoked once per `ExecutionStreamEvent` frame as
 * `streamExecutionApproval` reads them off the wire, named after the
 * event's `type` — see `execution-stream-events.ts` for the exact contract.
 * All optional so a caller only wires up what it cares about. Mirrors
 * `apps/web/features/bond/lib/use-bond-chat.ts`'s `BondChatCallbacks`.
 */
export interface ExecutionStreamCallbacks {
  onExecutionStarted?: (event: Extract<ExecutionStreamEvent, { type: 'execution_started' }>) => void;
  onStepStarted?: (event: Extract<ExecutionStreamEvent, { type: 'step_started' }>) => void;
  onStepSkipped?: (event: Extract<ExecutionStreamEvent, { type: 'step_skipped' }>) => void;
  onStepSucceeded?: (event: Extract<ExecutionStreamEvent, { type: 'step_succeeded' }>) => void;
  onStepFailed?: (event: Extract<ExecutionStreamEvent, { type: 'step_failed' }>) => void;
  onRollbackStarted?: (event: Extract<ExecutionStreamEvent, { type: 'rollback_started' }>) => void;
  onRollbackSucceeded?: (event: Extract<ExecutionStreamEvent, { type: 'rollback_succeeded' }>) => void;
  onRollbackFailed?: (event: Extract<ExecutionStreamEvent, { type: 'rollback_failed' }>) => void;
  onExecutionDone?: (event: Extract<ExecutionStreamEvent, { type: 'execution_done' }>) => void;
  onExecutionFailed?: (event: Extract<ExecutionStreamEvent, { type: 'execution_failed' }>) => void;
  onError?: (message: string) => void;
}

/**
 * POSTs to `/api/execution/[planId]/approve` and streams the SSE response,
 * invoking the matching `callbacks.on*` for every `ExecutionStreamEvent`
 * frame as it arrives. Never throws — request failures (non-OK response,
 * network error) and in-stream `{ type: 'error' }` events both resolve
 * through `callbacks.onError`, so callers don't need their own try/catch.
 * One request per call; call again to retry. Exact hand-rolled
 * fetch()+ReadableStream-reader structure as `streamBondChat` — see that
 * function's doc comment for why (no native EventSource, since this needs
 * POST).
 */
export async function streamExecutionApproval(
  planId: string,
  callbacks: ExecutionStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/execution/${encodeURIComponent(planId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
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

function dispatchFrame(frame: string, callbacks: ExecutionStreamCallbacks): void {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) return;

  const json = dataLine.slice('data: '.length);
  if (!json) return;

  let event: ExecutionStreamEvent;
  try {
    event = JSON.parse(json) as ExecutionStreamEvent;
  } catch {
    return;
  }

  switch (event.type) {
    case 'execution_started':
      callbacks.onExecutionStarted?.(event);
      return;
    case 'step_started':
      callbacks.onStepStarted?.(event);
      return;
    case 'step_skipped':
      callbacks.onStepSkipped?.(event);
      return;
    case 'step_succeeded':
      callbacks.onStepSucceeded?.(event);
      return;
    case 'step_failed':
      callbacks.onStepFailed?.(event);
      return;
    case 'rollback_started':
      callbacks.onRollbackStarted?.(event);
      return;
    case 'rollback_succeeded':
      callbacks.onRollbackSucceeded?.(event);
      return;
    case 'rollback_failed':
      callbacks.onRollbackFailed?.(event);
      return;
    case 'execution_done':
      callbacks.onExecutionDone?.(event);
      return;
    case 'execution_failed':
      callbacks.onExecutionFailed?.(event);
      return;
    case 'error':
      callbacks.onError?.(event.message);
      return;
    default: {
      // Exhaustiveness guard: a switch with no `default` doesn't error at
      // compile time on a missing case (this function returns `void`), so
      // this branch is what actually catches "a new ExecutionStreamEvent
      // variant was added but this dispatcher wasn't updated" — the same
      // class of gap that let `action_proposed` initially go unhandled in
      // `use-bond-chat.ts`'s dispatcher.
      const exhaustive: never = event;
      void exhaustive;
    }
  }
}
