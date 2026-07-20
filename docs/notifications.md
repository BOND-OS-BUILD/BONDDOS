# Notifications & Inbox (Phase 9)

## Scope

`apps/web/features/notifications/services/notification-fanout.service.ts` — the one function,
`notifyFromEvent()`, every Notification in this codebase is created through (mentions are the one
partial exception — see below) — and `notification.service.ts`, the read/manage half (list, mark
read, archive, snooze, and the Inbox's category summary). This doc covers the `Notification` model, the
corrected hook placement inside `publishEvent()`, the curated `eventType` → recipient mapping, the two
related Phase 9 fixes this step made to `ApprovalService`, and the Inbox's category system.

## The `Notification` model

Read/unread, archive, and snooze are plain columns on one mutable row — the same "single row, org-scoped
`updateMany` for every state transition" shape `ApprovalRequest` already established, not separate
tables per state. See `packages/database/prisma/schema.prisma`'s `Notification` model and
`packages/database/src/repositories/notifications.ts`.

## Hook placement: independent of `isDispatchEligible`, not "alongside" it

The first draft of this hook placed it next to the existing workflow-dispatch step inside
`publishEvent()`. That was wrong, and caught before any code was written: `isDispatchEligible()` returns
`false` for every `workflow.*` eventType and short-circuits at the top of `publishEvent()` — exactly the
event family this phase most needed to fan out (`workflow.notification`, published on run completion,
run failure, and from the NOTIFICATION step handler's own send result). Placing the notification hook
"alongside" dispatch would have silently skipped every one of them.

```ts
export async function publishEvent(input: PublishEventInput, budget?: WorkflowDispatchBudget): Promise<EventData> {
  const event = await createEvent({ /* ... */ });

  // independent of isDispatchEligible below, own try/catch
  try {
    await notifyFromEvent(event);
  } catch (error) { /* logged, never rethrown */ }

  if (!isDispatchEligible(event.eventType)) return event;
  try {
    await dispatchMatchingWorkflows(event, budget ?? /* ... */);
  } catch (error) { /* logged, never rethrown */ }

  return event;
}
```

The fix: call `notifyFromEvent` before the `isDispatchEligible` check, in its own `try`/`catch`,
completely independent of workflow dispatch. Two separate failure modes now can never mask each other —
a broken notification fan-out can't swallow a workflow-dispatch error and vice versa, and neither can
ever turn an ordinary domain write into a failed HTTP request, mirroring `publishEvent()`'s own existing
philosophy for dispatch failures.

## Static import, not the dynamic pattern

Every curated `publishEvent()` *caller* (`task.service.ts`, `project.service.ts`, etc.) imports
`publishEvent` dynamically to break a real circular-import chain through the Tool Registry (see
docs/event-bus.md). `event-bus.service.ts` importing `notifyFromEvent`, in the other direction, does
**not** need that: `notification-fanout.service.ts` only ever calls `@bond-os/database` repository
functions directly, never a `features/*` service layer, so it can never sit on the Tool Registry's
import chain. It's a plain static top-level import.

## Curated `eventType` → recipient mapping

| `eventType` | Recipients | Notification `type` |
|---|---|---|
| `task.updated` / `task.completed` | The task's assignee, looked up via `getTaskById` | `TASK_ASSIGNMENT` |
| `project.updated` | Every project member, via `getProjectById(...).members` | `PROJECT_UPDATE` |
| `workflow.notification` | The workflow's owner, via `getWorkflowDefinitionById(payload.workflowDefinitionId).ownerId` | `WORKFLOW_EVENT` |
| `insight.created` | Every org member holding ADMIN or OWNER, via `getOrganizationMembersByRole` | `AGENT_INSIGHT` |
| `approval.requested` | Every org member whose role satisfies the plan's `requiredRole` (not an exact match — `roleSatisfies` semantics) | `APPROVAL_REQUEST` |
| `comment.created` (with mentions) | The `mentionedUserIds` carried directly on the event payload — bypasses recipient resolution entirely, since a mention's target is already explicit | `MENTION` |

Any other `eventType` (including `project.created`, `document.uploaded`, `customer.created`, and
`meeting.*`) resolves to zero recipients today — this is a deliberately curated starting set, not an
attempt to notify on every domain event. Extending it is a new `case` in `resolveRecipients`.

Recipient resolution always ends in exactly one `createNotifications` batched `createMany` call per
event — never N sequential `create` calls, even when an event fans out to many recipients (all of a
project's members, for instance). This matters concretely: a single workflow run can legally contain a
loop of NOTIFICATION steps, each of which publishes its own `workflow.notification` event within the
same synchronous HTTP request — every one of those must stay a single cheap insert.

## The two verified-necessary `ApprovalService` fixes

`ApprovalService.requestApproval()`/`.approve()`/`.reject()` (Phase 6) previously published no Phase 8
Events at all — a confirmed, real gap, not something this phase merely touches in passing. Each method
now publishes `approval.requested` / `approval.approved` / `approval.rejected` respectively, which
`notifyFromEvent` fans out to whoever holds the plan's required role.

The import is **dynamically** deferred, and this is a verified correctness requirement rather than a
defensive default: tracing the actual static import graph shows `ApprovalService` is *already*
transitively inside `event-bus.service.ts`'s own import chain today — `event-bus.service.ts` →
`workflow-run.service.ts` → the step-handler registry → `invoke-tool.handler.ts` →
`plan-proposal.service.ts` → `execution/lib/container.ts` → `ApprovalService`. A static
`import { publishEvent } from '.../event-bus.service'` at the top of `approval.service.ts` would close
that into a genuine circular module graph the moment it was added — the same class of cycle
`task.service.ts` already avoids for the same reason (docs/event-bus.md).

## Inbox: 6 categories, all just curated `NotificationType` groupings

```ts
const CATEGORY_TYPES: Record<NotificationCategory, NotificationType[]> = {
  assigned: ['TASK_ASSIGNMENT'],
  mentions: ['MENTION'],
  approvals: ['APPROVAL_REQUEST'],
  ai_insights: ['AGENT_INSIGHT'],
  workflow_events: ['WORKFLOW_EVENT'],
  activity: ['PROJECT_UPDATE', 'MEETING_REMINDER', 'COMMENT', 'SYSTEM'],
};
```

The Inbox's 6 categories (Assigned/Mentions/Approvals/AI Insights/Workflow Events/Activity) are not a
separate model or a `category` column — they're this one mapping in `notification.service.ts`, resolved
into a `types: NotificationType[]` filter the existing repository already supports. `GET /api/inbox`
returns the 6 categories' unread counts (each reusing `listNotificationsForUser`'s own `WHERE`-scoped
`count()`, never a full row fetch) for the sidebar/tabs; `GET /api/notifications?category=<name>` returns
the actual paginated feed for one category. Two routes, one underlying table, one mapping.

## What this does NOT do

- **No email or push notifications.** Every Notification is in-app only — explicitly out of scope for
  this phase (spec: "No email or push notifications yet").
- **No notification preferences UI wired to fan-out yet.** The schema has room (`Notification.type`),
  but `notifyFromEvent` doesn't consult any per-user preference before fanning out in this phase.
- **No self-notification suppression.** `task.updated`/`task.completed` notify the assignee even when
  the assignee is also the one who made the change — the call sites that publish these events don't
  currently carry an "actor" identity in their payload, and adding one is out of scope for this step. A
  deliberate simplification, not an oversight.
