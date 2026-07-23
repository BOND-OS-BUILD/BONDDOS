/**
 * Phase 11 — the strongly-typed event catalog (client-safe). This is the
 * single source of truth for the event-type strings the platform emits, shared
 * by the Event Bus, outbound Webhooks, and the Extension SDK. Event-type
 * strings follow the existing `entity.verb` convention already used by
 * `publishEvent` call sites, so this layer is additive — it names and types
 * the events, it does not change how they are published.
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

/** Base envelope every consumer (webhook receiver, SDK subscriber) receives. */
export interface EventEnvelope<TPayload = Record<string, unknown>> {
  id: string;
  type: string;
  organizationId: string;
  occurredAt: string;
  payload: TPayload;
}

export interface EventCatalogEntry {
  type: EventTypeName;
  description: string;
}

/** Human-facing catalog powering the webhook subscription UI and SDK docs. */
export const EVENT_CATALOG: readonly EventCatalogEntry[] = [
  { type: EVENT_TYPES.PROJECT_CREATED, description: 'A project was created' },
  { type: EVENT_TYPES.PROJECT_UPDATED, description: 'A project was updated' },
  { type: EVENT_TYPES.PROJECT_DELETED, description: 'A project was deleted' },
  { type: EVENT_TYPES.TASK_CREATED, description: 'A task was created' },
  { type: EVENT_TYPES.TASK_UPDATED, description: 'A task was updated' },
  { type: EVENT_TYPES.TASK_COMPLETED, description: 'A task was completed' },
  { type: EVENT_TYPES.DOCUMENT_CREATED, description: 'A document was created' },
  { type: EVENT_TYPES.DOCUMENT_UPLOADED, description: 'A file was uploaded' },
  { type: EVENT_TYPES.MEETING_CREATED, description: 'A meeting was created' },
  { type: EVENT_TYPES.CUSTOMER_CREATED, description: 'A customer was created' },
  { type: EVENT_TYPES.COMMENT_ADDED, description: 'A comment was added' },
  { type: EVENT_TYPES.WORKFLOW_FINISHED, description: 'A workflow run finished' },
  { type: EVENT_TYPES.AI_RESPONSE_GENERATED, description: 'An AI response was generated' },
  { type: EVENT_TYPES.TOOL_EXECUTED, description: 'A tool was executed' },
  { type: EVENT_TYPES.USER_INVITED, description: 'A user was invited' },
  { type: EVENT_TYPES.ORGANIZATION_CREATED, description: 'An organization was created' },
];

export const ALL_EVENT_TYPES: string[] = EVENT_CATALOG.map((entry) => entry.type);

export const EVENT_WILDCARD = '*';

/**
 * Whether an event type matches one subscription pattern. Supported patterns:
 *   • `*`              — every event
 *   • `project.*`      — every event under the `project` namespace
 *   • `project.created`— an exact type
 */
export function eventTypeMatchesPattern(eventType: string, pattern: string): boolean {
  if (pattern === EVENT_WILDCARD) return true;
  if (pattern.endsWith('.*')) return eventType.startsWith(pattern.slice(0, -1));
  return eventType === pattern;
}

/** Whether an event matches ANY of a subscription's patterns. */
export function eventMatchesSubscription(eventType: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => eventTypeMatchesPattern(eventType, pattern));
}

/** Validate subscription patterns against the catalog (`*` and `ns.*` allowed). */
export function areEventPatternsValid(patterns: readonly string[]): boolean {
  return patterns.every((pattern) => {
    if (pattern === EVENT_WILDCARD) return true;
    if (pattern.endsWith('.*')) {
      const namespace = pattern.slice(0, -2);
      return ALL_EVENT_TYPES.some((type) => type.startsWith(`${namespace}.`));
    }
    return ALL_EVENT_TYPES.includes(pattern);
  });
}
