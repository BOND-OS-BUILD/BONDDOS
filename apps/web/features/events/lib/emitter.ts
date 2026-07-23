import { eventTypeMatchesPattern, type EventEnvelope } from '@bond-os/shared';
import { logger } from '@bond-os/shared/server';

const log = logger.child('event-emitter');

/**
 * Phase 11 — in-process, typed event emitter. Extensions and plugins register
 * handlers here (via the SDK) to react to events within the same runtime.
 *
 * Scope & guarantees: this is a best-effort, in-memory bus. Handlers run in the
 * process that published the event; on serverless there is no cross-instance
 * delivery and no persistence — for durable, cross-process, at-least-once
 * delivery use outbound Webhooks. Handler errors are isolated and logged so one
 * bad subscriber can never break publishing or another subscriber.
 */

export type EventHandler = (envelope: EventEnvelope) => void | Promise<void>;

interface Registration {
  pattern: string;
  handler: EventHandler;
  once: boolean;
}

const registrations = new Set<Registration>();

/** Subscribe to an event pattern (`*`, `ns.*`, or an exact type). Returns an unsubscribe fn. */
export function subscribe(pattern: string, handler: EventHandler): () => void {
  const registration: Registration = { pattern, handler, once: false };
  registrations.add(registration);
  return () => registrations.delete(registration);
}

/** Subscribe for a single matching event, then auto-unsubscribe. */
export function once(pattern: string, handler: EventHandler): () => void {
  const registration: Registration = { pattern, handler, once: true };
  registrations.add(registration);
  return () => registrations.delete(registration);
}

/** Remove a previously-registered handler (by identity + pattern). */
export function unsubscribe(pattern: string, handler: EventHandler): void {
  for (const registration of registrations) {
    if (registration.pattern === pattern && registration.handler === handler) {
      registrations.delete(registration);
    }
  }
}

/** Fan an event out to all matching in-process handlers. Never throws. */
export function emitLocal(envelope: EventEnvelope): void {
  for (const registration of [...registrations]) {
    if (!eventTypeMatchesPattern(envelope.type, registration.pattern)) continue;
    if (registration.once) registrations.delete(registration);
    try {
      const result = registration.handler(envelope);
      if (result instanceof Promise) {
        result.catch((error) => {
          log.error('Async event handler failed', {
            type: envelope.type,
            pattern: registration.pattern,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }
    } catch (error) {
      log.error('Event handler failed', {
        type: envelope.type,
        pattern: registration.pattern,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Current registered handler count — for diagnostics/tests. */
export function listenerCount(): number {
  return registrations.size;
}
