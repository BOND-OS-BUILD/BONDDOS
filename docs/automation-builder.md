# Automation Builder (Phase 11)

## Scope

The Automation Builder is the visual, no-code way to react to events — "when X
happens, do Y". Per the Phase 11 requirement, it **reuses the existing Workflow
Engine** rather than introducing a parallel automation system; the builder lives
at `/workflows/builder` (`ROUTES.workflowBuilder`) and is surfaced from the
Developer portal.

## How it works

Automations are workflow definitions. A workflow has a **trigger** (a
`TriggerType` mapped from an event — see `docs/workflows.md` and
`docs/event-bus.md`), optional **conditions**, and a **graph** of steps. When
`publishEvent()` fires a dispatch-eligible event, the Event Bus resolves the
active workflow definitions whose trigger matches and runs them
(`dispatchMatchingWorkflows`), bounded by the dispatch budget.

Because automations are ordinary workflow definitions, everything the Workflow
Engine already provides applies unchanged: run history, approvals, retries,
rollback, scheduling, and the workflow templates in the marketplace.

## Relationship to the rest of Phase 11

- **Events** — automations trigger on the same catalog of events that webhooks
  subscribe to and plugins hook (`docs/events.md`). One event can drive an
  in-app automation, an outbound webhook, and a plugin hook simultaneously,
  each isolated from the others.
- **Templates** — an automation can be exported as a `WORKFLOW` template and
  re-instantiated in another org (`docs/developer-portal.md` → Templates). See
  `exportWorkflowAsTemplateService` and `useTemplateService`.
- **Custom objects & forms** — automations can act on custom records created by
  form submissions, since those are ordinary Knowledge Graph entities.

## Where to look

- Builder UI: `apps/web/app/(dashboard)/workflows/builder`.
- Engine + dispatch: `apps/web/features/workflows/*`, especially
  `event-bus.service.ts` and `workflow-run.service.ts`.
- Trigger mapping: `mapEventTypeToTriggerType` in `event-bus.service.ts`.
