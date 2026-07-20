import { isAppError } from '@bond-os/shared';
import { logger } from '@bond-os/shared/server';

const log = logger.child('streaming');

/**
 * SSE transport for streaming route handlers — `apiHandler`/`apiSuccess`
 * are JSON-envelope-only by design (see api-handler.ts), so a streaming
 * response needs a different shape. Generic over the event type so it has
 * no knowledge of any one feature's event union.
 *
 * Pre-stream errors (auth/validation, thrown before the generator's first
 * `.next()`) must be surfaced as a normal JSON error response — the caller
 * primes the generator with one `await generator.next()` BEFORE calling
 * this function, inside the same `apiHandler` try/catch as everything else,
 * so those errors take the usual JSON-error path (headers haven't been
 * sent yet at that point). This function only ever handles what happens
 * AFTER that first successful event — in-stream errors are caught here and
 * emitted as a final SSE `error` event instead, since the HTTP status can
 * no longer change once bytes are flowing.
 */
export function createSseStream<T>(generator: AsyncGenerator<T>, primed: IteratorResult<T>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (event: T | { type: 'error'; message: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        if (!primed.done) {
          enqueue(primed.value);
          for await (const event of generator) {
            enqueue(event);
          }
        }
      } catch (error) {
        const message = isAppError(error) ? error.message : 'Something went wrong.';
        log.error('Stream error', { message: error instanceof Error ? error.message : String(error) });
        enqueue({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await generator.return(undefined as never).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
