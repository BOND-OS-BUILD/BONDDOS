import {
  createNotifications,
  getOrganizationMembersByRole,
  getProjectById,
  getTaskById,
  getWorkflowDefinitionById,
  type EventData,
  type NotificationType,
} from '@bond-os/database';
import { ROLE_HIERARCHY, type Role } from '@bond-os/shared';

/**
 * Fans a curated set of Event Bus `eventType`s out to `Notification` rows
 * (Phase 9) — called from `event-bus.service.ts`'s `publishEvent()`,
 * independent of workflow dispatch (see that file's own doc comment for
 * why). Always ONE batched `createNotifications` insert per event, never N
 * sequential ones — a single workflow run can legally publish many
 * `workflow.notification` events within one synchronous HTTP request (e.g.
 * a loop of NOTIFICATION steps), and each of those must stay cheap.
 *
 * Calls `@bond-os/database` repository functions directly, never a
 * `features/*` service layer — the same "don't recreate the Tool Registry
 * cycle" discipline every curated `publishEvent()` call site itself follows
 * (docs/event-bus.md). This file is a safe STATIC import for
 * `event-bus.service.ts` precisely because of that rule: it never reaches a
 * `features/*` service, so it can never sit on the Tool Registry's import
 * chain. See docs/notifications.md.
 */
export async function notifyFromEvent(event: EventData): Promise<void> {
  const recipients = await resolveRecipients(event);
  if (recipients.length === 0) return;

  await createNotifications(
    recipients.map((recipient) => ({
      organizationId: event.organizationId,
      userId: recipient.userId,
      type: recipient.type,
      title: recipient.title,
      body: recipient.body,
      entityType: event.entityType,
      entityId: event.entityId,
      sourceEventId: event.id,
    })),
  );
}

interface ResolvedRecipient {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && value in ROLE_HIERARCHY;
}

/** Every role that satisfies `minimumRole` (`roleSatisfies` semantics) — a plan requiring MEMBER is approvable by MEMBER, ADMIN, or OWNER, so all three should hear about it, not just an exact-role match. */
function rolesAtOrAbove(minimumRole: Role): Role[] {
  const threshold = ROLE_HIERARCHY[minimumRole];
  return (Object.keys(ROLE_HIERARCHY) as Role[]).filter((role) => ROLE_HIERARCHY[role] >= threshold);
}

async function resolveRecipients(event: EventData): Promise<ResolvedRecipient[]> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.eventType) {
    case 'task.updated':
    case 'task.completed': {
      const { taskId } = payload;
      if (typeof taskId !== 'string') return [];
      const task = await getTaskById(taskId, event.organizationId);
      if (!task?.assignee) return [];
      const completed = event.eventType === 'task.completed';
      return [
        {
          userId: task.assignee.id,
          type: 'TASK_ASSIGNMENT',
          title: completed ? 'Task completed' : 'Task updated',
          body: completed ? `"${task.title}" was marked done.` : `"${task.title}" was updated.`,
        },
      ];
    }

    case 'project.updated': {
      const { projectId } = payload;
      if (typeof projectId !== 'string') return [];
      const project = await getProjectById(projectId, event.organizationId);
      if (!project) return [];
      return project.members.map((member) => ({
        userId: member.id,
        type: 'PROJECT_UPDATE',
        title: 'Project updated',
        body: `"${project.title}" was updated.`,
      }));
    }

    case 'workflow.notification': {
      const { workflowDefinitionId, status } = payload;
      if (typeof workflowDefinitionId !== 'string') return [];
      const definition = await getWorkflowDefinitionById(workflowDefinitionId, event.organizationId);
      if (!definition?.ownerId) return [];
      const statusLabel = typeof status === 'string' ? status : 'reported an event';
      return [
        {
          userId: definition.ownerId,
          type: 'WORKFLOW_EVENT',
          title: `Workflow ${statusLabel}`,
          body: `"${definition.name}" ${statusLabel}.`,
        },
      ];
    }

    case 'insight.created': {
      const { title } = payload;
      const recipients = await getOrganizationMembersByRole(event.organizationId, rolesAtOrAbove('ADMIN'));
      return recipients.map((recipient) => ({
        userId: recipient.id,
        type: 'AGENT_INSIGHT',
        title: 'New AI insight',
        body: typeof title === 'string' ? title : 'A new insight is ready to review.',
      }));
    }

    case 'approval.requested': {
      const { requiredRole, planId } = payload;
      if (!isRole(requiredRole)) return [];
      const recipients = await getOrganizationMembersByRole(event.organizationId, rolesAtOrAbove(requiredRole));
      return recipients.map((recipient) => ({
        userId: recipient.id,
        type: 'APPROVAL_REQUEST',
        title: 'Approval requested',
        body: `An action is waiting on your approval${typeof planId === 'string' ? ` (plan ${planId.slice(0, 8)})` : ''}.`,
      }));
    }

    // Wired once Comments (Phase 9 Step 6) publish `comment.created` with a
    // `mentionedUserIds` payload — a mention's target is already explicit,
    // so this bypasses generic recipient resolution entirely.
    case 'comment.created': {
      const { mentionedUserIds, authorId, snippet } = payload;
      if (!Array.isArray(mentionedUserIds)) return [];
      return mentionedUserIds
        .filter((id): id is string => typeof id === 'string' && id !== authorId)
        .map((userId) => ({
          userId,
          type: 'MENTION',
          title: 'You were mentioned',
          body: typeof snippet === 'string' ? snippet : 'You were mentioned in a comment.',
        }));
    }

    default:
      return [];
  }
}
