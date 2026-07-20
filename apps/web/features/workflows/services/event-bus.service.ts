import {
  createEvent,
  listActiveWorkflowDefinitionsForTrigger,
  type EventData,
  type EventSource,
  type Prisma,
  type WorkflowDefinitionData,
} from '@bond-os/database';
import { getEnv, logger } from '@bond-os/shared/server';

import { notifyFromEvent } from '@/features/notifications/services/notification-fanout.service';

import { createWorkflowDispatchBudget, consumeWorkflowStep, enterWorkflowDispatch, type WorkflowDispatchBudget } from '../lib/workflow-dispatch-budget';
import { evaluateWorkflowCondition, type WorkflowConditionContext, type WorkflowConditionNode } from '../lib/workflow-condition';
import { startWorkflowRun } from './workflow-run.service';

const log = logger.child('event-bus');

/**
 * The Event Bus (Phase 8) — synchronous, in-process. `publishEvent()`
 * persists the `Event` row unconditionally, then attempts to dispatch
 * matching workflows wrapped in try/catch so a workflow failure/slowness
 * can never break the caller — mirrors `library.service.ts`'s
 * `runSmartLinkingForDocument`, already "wrapped so it can't break upload."
 * Callers never await dispatch failing; they only ever see the persisted
 * `Event`. See docs/event-bus.md.
 */

export interface PublishEventInput {
  organizationId: string;
  eventType: string;
  source: EventSource;
  payload: Record<string, unknown>;
  /** Root events omit this — a fresh id is generated. Nested events (produced by a workflow step) pass the chain's existing correlationId through unchanged. */
  correlationId?: string;
  /** Nested events set this to the `WorkflowRunStep.id` that produced them — see `WorkflowDispatchBudget`'s cycle-guard composition rule. */
  causationId?: string;
  metadata?: Record<string, unknown>;
  /**
   * Phase 9, additive: denormalized onto the `Event` row from `payload` at
   * curated call sites that concern one entity — what lets the Activity
   * Feed filter by project/task/entity as a real indexed query instead of a
   * payload-JSON scan. Loosely typed (no hard FK), matching
   * `Comment.entityType`/`entityId`'s own shape. Omitted at call sites with
   * no single natural entity (e.g. `approval.*` still sets it to the plan).
   */
  entityType?: string;
  entityId?: string;
}

/**
 * `workflow.*` events (the 5 notification moments, all persisted as
 * `workflow.notification`) are never eligible trigger sources — otherwise
 * "notify me when a notification fires" is an ordinary-user-reachable
 * infinite loop, not an edge case. Enforced here, not left to the dispatch
 * budget alone (defense in depth: this makes the loop unreachable rather
 * than merely bounded).
 */
function isDispatchEligible(eventType: string): boolean {
  return !eventType.startsWith('workflow.');
}

const TRIGGER_TYPE_BY_EVENT_SUFFIX: Array<{ suffix: string; triggerType: 'ENTITY_CREATED' | 'ENTITY_UPDATED' | 'ENTITY_DELETED' | 'FILE_UPLOADED' | 'AI_INSIGHT' }> = [
  { suffix: '.uploaded', triggerType: 'FILE_UPLOADED' },
  { suffix: '.created', triggerType: 'ENTITY_CREATED' },
  { suffix: '.deleted', triggerType: 'ENTITY_DELETED' },
  { suffix: '.completed', triggerType: 'ENTITY_UPDATED' },
  { suffix: '.updated', triggerType: 'ENTITY_UPDATED' },
];

/** Deterministic, convention-based mapping from a curated `eventType` string to the `TriggerType` bucket workflows register against — `insight.*` events are the one exception, always `AI_INSIGHT` regardless of suffix. */
function mapEventTypeToTriggerType(eventType: string): WorkflowDefinitionData['triggerType'] | null {
  if (eventType.startsWith('insight.')) return 'AI_INSIGHT';
  const match = TRIGGER_TYPE_BY_EVENT_SUFFIX.find((entry) => eventType.endsWith(entry.suffix));
  return match?.triggerType ?? null;
}

interface TriggerConfig {
  type: string;
  config?: { source?: EventSource; eventType?: string };
}

function matchesTriggerConfig(trigger: unknown, event: EventData): boolean {
  if (!trigger || typeof trigger !== 'object') return false;
  const { config } = trigger as TriggerConfig;
  if (!config) return true; // no further filter — any event of this triggerType matches
  if (config.source && config.source !== event.source) return false;
  if (config.eventType && config.eventType !== event.eventType) return false;
  return true;
}

export async function publishEvent(input: PublishEventInput, budget?: WorkflowDispatchBudget): Promise<EventData> {
  const correlationId = input.correlationId ?? crypto.randomUUID();

  const event = await createEvent({
    organizationId: input.organizationId,
    eventType: input.eventType,
    source: input.source,
    payload: input.payload as Prisma.InputJsonValue,
    correlationId,
    causationId: input.causationId ?? null,
    metadata: input.metadata as Prisma.InputJsonValue | undefined,
    entityType: input.entityType,
    entityId: input.entityId,
  });

  // Independent of `isDispatchEligible` below, in its own try/catch — that
  // check exists to stop `workflow.*` events from re-triggering the Event
  // Bus (see `isDispatchEligible`'s own doc comment), which has nothing to
  // do with whether a human inbox should hear about this event. Fanning
  // `workflow.notification` (completion/failure/send-result) into a
  // Notification is a real Phase 9 requirement, not an edge case — placing
  // this alongside the dispatch gate would silently skip it. A failure here
  // must never mask, or be masked by, a workflow-dispatch failure below.
  // A static import, not the dynamic pattern every OTHER `publishEvent()`
  // caller uses: `notification-fanout.service.ts` only calls `@bond-os/
  // database` repository functions directly, never a `features/*` service,
  // so it can never sit on the Tool Registry's import chain the way
  // `task.service.ts`/`create-task.tool.ts` do — there is no cycle here to
  // break.
  try {
    await notifyFromEvent(event);
  } catch (error) {
    log.error('Notification fan-out failed for event', {
      eventId: event.id,
      organizationId: event.organizationId,
      eventType: event.eventType,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!isDispatchEligible(event.eventType)) return event;

  try {
    const env = getEnv();
    await dispatchMatchingWorkflows(event, budget ?? createWorkflowDispatchBudget(env.WORKFLOW_MAX_SYNC_STEPS, env.WORKFLOW_MAX_SYNC_MS));
  } catch (error) {
    log.error('Workflow dispatch failed for event', {
      eventId: event.id,
      organizationId: event.organizationId,
      eventType: event.eventType,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return event;
}

async function dispatchMatchingWorkflows(event: EventData, budget: WorkflowDispatchBudget): Promise<void> {
  const triggerType = mapEventTypeToTriggerType(event.eventType);
  if (!triggerType) return;

  const candidates = await listActiveWorkflowDefinitionsForTrigger(event.organizationId, triggerType);
  if (candidates.length === 0) return;

  const context: WorkflowConditionContext = {
    organizationId: event.organizationId,
    eventType: event.eventType,
    source: event.source,
    payload: (event.payload as Record<string, unknown>) ?? {},
  };

  // Sequential, not Promise.all — the budget is a single shared, mutated
  // object; dispatching in parallel would race on its own consumption.
  for (const definition of candidates) {
    if (!matchesTriggerConfig(definition.trigger, event)) continue;

    const conditions = definition.conditions as WorkflowConditionNode | null;
    if (conditions && !(await evaluateWorkflowCondition(context, conditions))) continue;

    enterWorkflowDispatch(budget, definition.id);
    consumeWorkflowStep(budget);
    await startWorkflowRun(definition, event, budget);
  }
}
