/**
 * Typed event catalog + in-process router for the SDK. Mirrors the server's
 * event-type strings so extension code can subscribe to received webhook
 * events (or plugin events) with autocomplete and pattern matching.
 */

export const EVENT_TYPES = {
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_DELETED: 'project.deleted',
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_COMPLETED: 'task.completed',
  DOCUMENT_CREATED: 'document.created',
  DOCUMENT_UPLOADED: 'document.uploaded',
  MEETING_CREATED: 'meeting.created',
  CUSTOMER_CREATED: 'customer.created',
  COMMENT_ADDED: 'comment.added',
  WORKFLOW_FINISHED: 'workflow.finished',
  AI_RESPONSE_GENERATED: 'ai.response.generated',
  TOOL_EXECUTED: 'tool.executed',
  USER_INVITED: 'user.invited',
  ORGANIZATION_CREATED: 'organization.created',
} as const;

export type EventTypeName = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface EventEnvelope<TPayload = Record<string, unknown>> {
  id: string;
  type: string;
  organizationId: string;
  occurredAt: string;
  payload: TPayload;
}

export type EventHandler<TPayload = Record<string, unknown>> = (
  event: EventEnvelope<TPayload>,
) => void | Promise<void>;

/** Match an event type against `*`, `ns.*`, or an exact type. */
export function eventTypeMatchesPattern(eventType: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return eventType.startsWith(pattern.slice(0, -1));
  return eventType === pattern;
}

export interface EventRouter {
  on<TPayload = Record<string, unknown>>(pattern: string, handler: EventHandler<TPayload>): () => void;
  off(pattern: string, handler: EventHandler): void;
  /** Dispatch a received event to all matching handlers (awaits async ones). */
  dispatch(event: EventEnvelope): Promise<void>;
}

/**
 * A tiny pattern-based router for turning received webhook events into typed
 * handler calls:
 *
 * ```ts
 * const router = createEventRouter();
 * router.on(EVENT_TYPES.TASK_COMPLETED, (e) => console.log(e.payload));
 * await router.dispatch(await parseWebhookEvent({ ... }));
 * ```
 */
export function createEventRouter(): EventRouter {
  const registrations = new Set<{ pattern: string; handler: EventHandler }>();
  return {
    on(pattern, handler) {
      const registration = { pattern, handler: handler as EventHandler };
      registrations.add(registration);
      return () => registrations.delete(registration);
    },
    off(pattern, handler) {
      for (const registration of registrations) {
        if (registration.pattern === pattern && registration.handler === handler) {
          registrations.delete(registration);
        }
      }
    },
    async dispatch(event) {
      for (const registration of [...registrations]) {
        if (eventTypeMatchesPattern(event.type, registration.pattern)) {
          await registration.handler(event);
        }
      }
    },
  };
}
