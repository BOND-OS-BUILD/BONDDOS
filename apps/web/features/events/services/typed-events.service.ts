import type { EventSource } from '@bond-os/database';
import type { EventTypeName } from '@bond-os/shared';

import { publishEvent } from '@/features/workflows/services/event-bus.service';

/**
 * Phase 11 — strongly-typed publish facade over the existing Event Bus. Call
 * sites (and the SDK) publish a named catalog event (`EVENT_TYPES.*`) with a
 * typed source, and this forwards to `publishEvent` unchanged — so the durable
 * Event row, notification fan-out, workflow dispatch, webhook dispatch, and
 * in-process emitter all still run exactly once. Additive: existing
 * `publishEvent` call sites are untouched.
 */

export interface PublishTypedEventInput {
  organizationId: string;
  type: EventTypeName;
  source: EventSource;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}

export async function publishTypedEvent(input: PublishTypedEventInput): Promise<{ id: string }> {
  const event = await publishEvent({
    organizationId: input.organizationId,
    eventType: input.type,
    source: input.source,
    payload: input.payload,
    correlationId: input.correlationId,
    causationId: input.causationId,
    metadata: input.metadata,
    entityType: input.entityType,
    entityId: input.entityId,
  });
  return { id: event.id };
}
