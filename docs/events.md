# Typed Events (Phase 11)

## Scope

Phase 11 adds a **strongly-typed layer** and two new fan-outs on top of the
existing Phase 8 Event Bus (`docs/event-bus.md`). Nothing about how events are
published changed — this layer names and types the events and adds delivery to
webhooks and to in-process subscribers.

## The catalog

`packages/shared/src/events.ts` is the single source of truth for the event-type
strings the platform emits, following the existing `entity.verb` convention:

`project.created/updated/deleted`, `task.created/updated/completed`,
`document.created/uploaded`, `meeting.created`, `customer.created`,
`comment.added`, `workflow.finished`, `ai.response.generated`, `tool.executed`,
`user.invited`, `organization.created` — exported as `EVENT_TYPES` with an
`EVENT_CATALOG` (type + description) that powers the webhook subscription UI and
the SDK.

Pattern matching (`eventTypeMatchesPattern`, `eventMatchesSubscription`,
`areEventPatternsValid`) supports `*`, `ns.*`, and exact types, and is reused by
webhooks, plugins, and the SDK's event router.

## Typed publish

`apps/web/features/events/services/typed-events.service.ts` exposes
`publishTypedEvent({ organizationId, type, source, payload, … })`, where `type`
is constrained to a catalog `EventTypeName`. It forwards to the existing
`publishEvent()` unchanged, so the durable `Event` row, notification fan-out,
workflow dispatch, webhook dispatch, and in-process emitter all still run
exactly once. Existing `publishEvent()` call sites are untouched.

## In-process emitter

`apps/web/features/events/lib/emitter.ts` is a best-effort, in-memory,
pattern-based emitter (`subscribe` / `once` / `unsubscribe` / `emitLocal`).
`publishEvent()` calls `emitLocal(envelope)` for every event. Handler errors are
isolated and logged, so one bad subscriber can never break publishing or another
subscriber.

**Guarantees:** the emitter is single-runtime and non-durable — on serverless
there is no cross-instance delivery. For durable, cross-process, at-least-once
delivery use **webhooks** (`docs/webhooks.md`). The emitter is for plugins and
SDK code running inside the same process.

## Fan-out order in `publishEvent()`

1. Persist the `Event` row.
2. Notification fan-out (Phase 9) — isolated.
3. `emitLocal` to in-process subscribers.
4. `dispatchEventToWebhooks` — isolated.
5. Workflow dispatch (if the event type is dispatch-eligible) — isolated.

Every step after (1) is wrapped so a failure in one can never mask or be masked
by another, nor affect the caller.
