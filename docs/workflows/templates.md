# Templates

## Scope

`apps/web/features/workflows/templates/registry.ts` — 5 built-in, organization-agnostic starting-point
workflows — and `apps/web/features/workflows/services/workflow-template.service.ts`, the one function
that turns a template into a real, editable `WorkflowDefinition` for a specific organization. This doc
covers the 5 templates' actual trigger/graph shapes as implemented, why instantiating a template always
produces a new `DRAFT` and never an auto-published workflow, and the instantiate endpoint.

## Templates are plain developer-owned data, not database rows

`registry.ts`'s own doc comment draws the line precisely:

```ts
/**
 * Built-in Workflow Templates — organization-agnostic starting points a
 * user instantiates into their own editable `DRAFT` `WorkflowDefinition`
 * via `workflow-template.service.ts`. A template is plain developer-owned
 * data (mirrors `ALL_HANDLERS` in `../registry.ts` and every other fixed
 * catalog in this codebase — Tools, Agents), not a database row, so it
 * never needs an `organizationId`.
 */
export interface WorkflowTemplateDefinition {
  /** Stable slug — looked up by `instantiateWorkflowTemplateService`. Never changes once shipped. */
  templateKey: string;
  name: string;
  description: string;
  triggerType: TriggerType;
  /** `{ type, config }` — `config` is what `event-bus.service.ts`'s `matchesTriggerConfig` actually filters on (`source`/`eventType`); for `SCHEDULED`/`MANUAL` triggers `config` is empty since a `WorkflowSchedule` row (cron + timezone) is attached separately once the organization activates the workflow. */
  trigger: Record<string, unknown>;
  graph: WorkflowGraphDefinition;
}
```

`WORKFLOW_TEMPLATES` is a literal, in-memory array — the same "fixed catalog, populated at module load"
shape as the Tool Registry, the Agent Registry, and this platform's own step-handler registry (see
[Workflow Engine](./workflow-engine.md)). A `WorkflowTemplateDefinition` is never persisted anywhere on
its own; it exists purely to be read by `instantiateWorkflowTemplateService` and copied into a
brand-new, organization-owned `WorkflowDefinition` row.

> **Note on the `SCHEDULED` template's own comment:** `weekly-project-report`'s trigger config comment
> says a `WorkflowSchedule` row is "attached separately once the organization activates the workflow."
> As documented in [Scheduler](./scheduler.md), no code path anywhere in this codebase actually creates
> a `WorkflowSchedule` row today — so instantiating and publishing this template produces a fully valid
> `ACTIVE` `SCHEDULED`-trigger workflow that will never fire until that gap is closed.

Every template's `graph` is deliberately conservative about what it wires via `$steps.<key>.output.<path>`
references, because of a real, documented limitation of `dag.ts`'s `resolveStepParams`: that resolver
only substitutes a reference when it is the *entire* value of a top-level `params` key, never a
reference nested inside an array/object value. Two consequences visible directly in the templates
below:

1. A `READ_DATA` step's `id` is always a literal `REPLACE_WITH_*` placeholder, never a reference —
   there is no "list all X" step type and no `$trigger.*` syntax for pulling a field out of the event
   that started the run (only prior step *outputs* are reachable), so an organization fills in the
   concrete id after instantiating.
2. Only references that resolve to the exact type a step validates are used as a top-level param value
   (e.g. `NOTIFICATION.subject` ← `GENERATE_REPORT.output.title`, string ← string). A couple of
   templates additionally nest a `$steps...` reference inside a `GENERATE_REPORT` section's `content`
   to show the intended data-shape wiring for a human reviewing the draft — harmless (that field is
   untyped `unknown`) even though today's shallow `resolveStepParams` won't substitute it at runtime,
   left as documentation for whoever extends `dag.ts`'s resolver next.

## The 5 templates

### `weekly-project-report`

*"Reads a project, assembles a status report, and emails it out on a schedule. After instantiating, set
the project id, recipient email, and attach a cron schedule to activate."*

- **`triggerType`:** `SCHEDULED` — `trigger: { type: 'SCHEDULED', config: {} }`. `config` is empty
  because a `SCHEDULED` trigger's actual cadence lives on a separate `WorkflowSchedule` row (cron
  expression + timezone) — see the scheduler gap noted above.
- **Graph (3 steps, linear chain):**
  1. `read_project` (`READ_DATA`) — `{ entityType: 'project', id: 'REPLACE_WITH_PROJECT_ID' }`
  2. `build_report` (`GENERATE_REPORT`, depends on `read_project`) — one section,
     `content: '$steps.read_project.output.record'`
  3. `notify_report` (`NOTIFICATION`, depends on `build_report`) — `to: 'REPLACE_WITH_RECIPIENT_EMAIL'`,
     `subject: '$steps.build_report.output.title'` (a real, resolved top-level reference — string-to-
     string, satisfying the constraint above), fixed body text pointing the recipient back into the app.

### `new-employee-onboarding`

*"Sends a welcome email, proposes an onboarding checklist task for approval, and notifies the manager
once it is ready to review. Triggered manually when a new hire starts."*

- **`triggerType`:** `MANUAL` — `trigger: { type: 'MANUAL', config: {} }`, fired via the "Run Now"
  surface (`WorkflowRunService.triggerManual`), not an event match.
- **Graph (3 steps):**
  1. `welcome_email` (`NOTIFICATION`, no dependencies) — `to: 'REPLACE_WITH_NEW_EMPLOYEE_EMAIL'`, a
     fixed welcome message.
  2. `create_onboarding_task` (`INVOKE_TOOL`, no dependencies) — the one step in this template that
     reaches a write: `{ __toolKey: 'create_task', __version: '1', title, description, projectId:
     'REPLACE_WITH_ONBOARDING_PROJECT_ID', assigneeId: 'REPLACE_WITH_MANAGER_USER_ID', status: 'TODO',
     priority: 'HIGH' }`. This step pauses the run at `WAITING_APPROVAL` exactly like any other
     `INVOKE_TOOL` step (see [Approvals](./approvals.md)) — a human must approve the proposed task
     before this workflow's run can proceed.
  3. `notify_manager` (`NOTIFICATION`, depends on `create_onboarding_task`) — tells the manager a task
     is awaiting their review.

  `welcome_email` and `create_onboarding_task` both declare `dependsOn: []` — they land in the same DAG
  layer and run concurrently (in the sense of "same layer"; recall the driver still visits steps within
  a layer sequentially, see [Workflow Engine](./workflow-engine.md)); only `notify_manager` waits on the
  task-creation step.

### `customer-follow-up-reminder`

*"Waits three days after a customer record changes, then reminds the assigned salesperson to follow up.
Set the salesperson email after instantiating."*

- **`triggerType`:** `ENTITY_UPDATED` — `trigger: { type: 'ENTITY_UPDATED', config: { source: 'CUSTOMER' } }`,
  matching the `customer.created` event's `source: 'CUSTOMER'` (note the template's own description says
  "changes," and its trigger config filters by `source` only, not a specific `eventType` — any
  `ENTITY_UPDATED`-bucketed `CUSTOMER`-source event matches; see [Event Bus](./event-bus.md)'s curated
  call-site table for which `customer.*` events actually exist today).
- **Graph (2 steps):**
  1. `wait_before_followup` (`DELAY`, no dependencies) — `{ durationMs: 259_200_000 }`
     (3 days, `1000 * 60 * 60 * 24 * 3`).
  2. `remind_salesperson` (`NOTIFICATION`, depends on `wait_before_followup`) —
     `to: 'REPLACE_WITH_SALESPERSON_EMAIL'`, a fixed reminder body.

  This is the simplest possible demonstration of the re-entrant driver's whole reason for existing (see
  [Workflow Engine](./workflow-engine.md)) — a run started synchronously inside the customer-update
  request pauses at `WAITING_TIMER` almost immediately and is only resumed three days later by the tick
  endpoint (see [Scheduler](./scheduler.md); unlike the `SCHEDULED`-trigger template above, this one
  only depends on the tick endpoint being wired up, not on the `WorkflowSchedule`-creation gap, since a
  `DELAY` step's `waitUntil` is written by the driver itself, not by a `WorkflowSchedule` row).

### `meeting-action-item-generator`

*"Reads a newly logged meeting, asks the Project Agent to draft action items from it, and emails the
draft to the project lead. Set the meeting id and recipient after instantiating."*

- **`triggerType`:** `ENTITY_CREATED` — `trigger: { type: 'ENTITY_CREATED', config: { source: 'MEETING' } }`,
  matching `meeting.created`.
- **Graph (3 steps, linear chain):**
  1. `read_meeting` (`READ_DATA`) — `{ entityType: 'meeting', id: 'REPLACE_WITH_MEETING_ID' }`
  2. `draft_action_items` (`INVOKE_AGENT`, depends on `read_meeting`) — `{ agentKey: 'project_agent',
     question: 'Review the meeting that was just logged and draft a clear list of action items, each
     with a suggested owner and due date.' }`. This is Phase 7's Project specialist agent
     (`docs/agents/overview.md`), invoked read-only unless its own turn happens to propose an action
     (in which case this step, too, would pause at `waiting_approval` — see
     [Workflow Engine](./workflow-engine.md)'s `INVOKE_AGENT` section).
  3. `notify_action_items` (`NOTIFICATION`, depends on `draft_action_items`) —
     `to: 'REPLACE_WITH_PROJECT_LEAD_EMAIL'`, `body: '$steps.draft_action_items.output.answer'` — the
     agent's own answer text, resolved as a top-level string reference straight into the email body.

### `document-approval-flow`

*"Reads a newly uploaded document, asks the Operations Agent to review it, and notifies the approver
with the recommendation. Set the document id and approver email after instantiating."*

- **`triggerType`:** `ENTITY_CREATED` — `trigger: { type: 'ENTITY_CREATED', config: { source: 'DOCUMENT' } }`,
  matching `document.uploaded`.
- **Graph (3 steps, linear chain):**
  1. `read_document` (`READ_DATA`) — `{ entityType: 'document', id: 'REPLACE_WITH_DOCUMENT_ID' }`
  2. `review_document` (`INVOKE_AGENT`, depends on `read_document`) — `{ agentKey: 'operations_agent',
     question: 'Review the newly uploaded document and recommend whether it should be approved, noting
     any concerns that should block approval.' }`.
  3. `notify_approval_outcome` (`NOTIFICATION`, depends on `review_document`) —
     `to: 'REPLACE_WITH_APPROVER_EMAIL'`, `body: '$steps.review_document.output.answer'`.

Three of the five templates (`meeting-action-item-generator`, `document-approval-flow`, and — for its
`INVOKE_TOOL` step — `new-employee-onboarding`) exercise the full breadth of what a workflow step can
reach: a plain read, an agent turn, and a human-in-the-loop write, each pausing and resuming through the
re-entrant driver. The other two (`weekly-project-report`, `customer-follow-up-reminder`) stay entirely
deterministic — no agent, no write — demonstrating that a useful workflow doesn't require either.

## Instantiating always creates a new `DRAFT`, never auto-published

`workflow-template.service.ts`'s own doc comment states the invariant directly:

```ts
/**
 * Instantiates a built-in Workflow Template into a fresh, editable `DRAFT`
 * `WorkflowDefinition` — the one place `WORKFLOW_TEMPLATES` (plain
 * developer-owned data) meets `WorkflowDefinitionService.create()` (the
 * per-organization write path, which already enforces `requireRole` and
 * `validateGraph`). Never auto-publishes: the org reviews/edits the draft
 * (e.g. filling in the template's `REPLACE_WITH_*` placeholders, setting an
 * owner) and calls the existing `publish` endpoint themselves when ready.
 */
export async function instantiateWorkflowTemplateService(
  organizationId: string,
  userId: string,
  input: InstantiateWorkflowTemplateInput,
): Promise<WorkflowDefinitionData> {
  const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.templateKey === input.templateKey);
  if (!template) throw new NotFoundError(`Workflow template "${input.templateKey}" not found.`);

  return getWorkflowDefinitionService().create(organizationId, userId, {
    workflowKey: input.workflowKey,
    version: '1',
    name: input.name ?? template.name,
    description: template.description,
    triggerType: template.triggerType,
    trigger: template.trigger as unknown as Prisma.InputJsonValue,
    graph: template.graph as unknown as Prisma.InputJsonValue,
  });
}
```

There is no separate "instantiate and activate" code path — this function calls the exact same
`WorkflowDefinitionService.create()` any hand-built workflow goes through, which defaults every new row
to `WorkflowDefinitionStatus.DRAFT` and enforces the identical `requireRole` and `validateGraph` checks
a template's graph has to satisfy just like any user-authored one. This matters concretely, not just as
a policy statement: every template ships with literal `REPLACE_WITH_*` placeholder strings baked into
its `graph` (a project id, a meeting id, a recipient email, and so on) — a template instantiated
straight into `ACTIVE` would immediately start matching real events against `READ_DATA`/`NOTIFICATION`
steps addressed at placeholder ids and non-existent inboxes. Landing as `DRAFT` is what gives an
organization the chance to fill those in through the visual builder (`WorkflowDefinitionService.updateDraft`)
— and, for `new-employee-onboarding` specifically, to set a real `ownerId` before publishing, since a
graph containing an `INVOKE_TOOL` step cannot be published without one
(`WorkflowDefinitionService.publish`'s own check, see [Approvals](./approvals.md)) — before ever calling
the separate, existing `publish` endpoint themselves. Nothing about the instantiate call itself can
activate a workflow.

## The instantiate endpoint

```ts
// GET /api/workflows/templates — lightweight metadata only (no `graph`)
export const GET = apiHandler(async () => {
  await requireActiveOrganizationId();
  const templates = WORKFLOW_TEMPLATES.map((template) => ({
    templateKey: template.templateKey,
    name: template.name,
    description: template.description,
    triggerType: template.triggerType,
  }));
  return apiSuccess(templates);
});
```

```ts
// POST /api/workflows/templates/[key]/instantiate
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const { key } = await params;
  const body = await parseJsonBody(request, instantiateBodySchema);

  const definition = await instantiateWorkflowTemplateService(organizationId, user.id, { templateKey: key, ...body });

  return apiSuccess(definition, { status: 201 });
});
```

`GET /api/workflows/templates` lists every entry in `WORKFLOW_TEMPLATES` with its `graph` deliberately
stripped — just enough metadata (`templateKey`, `name`, `description`, `triggerType`) for a picker UI;
the full step-by-step graph is only returned once a template is actually instantiated.

`POST /api/workflows/templates/[key]/instantiate` takes the `templateKey` from the URL path, not the
request body — `instantiateBodySchema` is `instantiateWorkflowTemplateSchema.omit({ templateKey: true })`,
i.e. just `{ workflowKey: string, name?: string }`:

```ts
export const instantiateWorkflowTemplateSchema = z.object({
  templateKey: z.string().min(1),
  workflowKey: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200).optional(),
});
```

`workflowKey` is the caller-chosen stable slug the new `WorkflowDefinition` will be looked up by within
the organization (`@@unique([organizationId, workflowKey, version])`); `name` optionally overrides the
template's own default display name. Both `requireAuth()` and `assertSameOrigin` are present — this is
an ordinary authenticated, same-origin, session-backed route, same shape as any other Phase 8 CRUD
endpoint, not the tick/webhook routes' external-caller pattern (see [Scheduler](./scheduler.md)). A
successful instantiate returns the new `DRAFT` `WorkflowDefinition` row itself with HTTP `201`.

The [Builder](./builder.md)'s `WorkflowTemplatesSection` component is the one UI surface that calls
this: it fetches `GET /api/workflows/templates` client-side, renders one card per template with a "Use
this template" modal (pre-filled `name` and a slugified `workflowKey` suggestion, both still editable),
and on success routes straight into `/workflows/builder/{new id}` — the only workflow-creation path
exposed anywhere in the app's UI today.

## What this does NOT do

- **No template marketplace or organization-authored templates.** `WORKFLOW_TEMPLATES` is a fixed,
  5-entry, developer-owned array — there is no way for an organization to save one of its own workflows
  back as a reusable template, and no way to install a template from outside this codebase. Adding a
  6th built-in template is a source-code change to `registry.ts`.
- **No auto-filled placeholders.** Every `REPLACE_WITH_*` string in a template's graph is instantiated
  verbatim — nothing infers a real project id, email address, or agent target on the organization's
  behalf. A human has to edit the draft before it's usable.
- **No auto-activation, ever, under any circumstance.** Covered above —
  `instantiateWorkflowTemplateService` calls the same `create()` every hand-built workflow uses, which
  always lands `DRAFT`. There is no "instantiate and publish in one call" variant of this endpoint.
- **No versioning of templates against instantiated definitions.** A `WorkflowTemplateDefinition` itself
  is not versioned the way a `WorkflowDefinition` is — if a template's built-in graph changes in a
  future release, a `WorkflowDefinition` an organization already instantiated from an earlier version of
  that template is not retroactively updated; it's a fully independent row from the moment `create()`
  returns it.

## Documentation index

- **[Overview](./overview.md)** — why `WorkflowDefinition` is org-owned data while a template (like a
  step-type handler) is developer-owned code, and the full versioned-once-published model a template's
  output eventually becomes.
- **[Workflow Engine](./workflow-engine.md)** — every step type a template's graph can use, and their
  real params/output shapes.
- **[Approvals](./approvals.md)** — what happens when `new-employee-onboarding`'s
  `create_onboarding_task` step pauses a run at `WAITING_APPROVAL`.
- **[Scheduler](./scheduler.md)** — attaching a `WorkflowSchedule` to an activated
  `weekly-project-report` instance (and the confirmed gap in doing so today), and how
  `customer-follow-up-reminder`'s `DELAY` step actually gets resumed.
- **[Builder](./builder.md)** — the `WorkflowTemplatesSection` UI this doc's instantiate endpoint feeds.
