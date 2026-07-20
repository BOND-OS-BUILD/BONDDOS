import { requireRole } from '@bond-os/auth';
import {
  areAllUsersInOrganization,
  createTask as createTaskRow,
  deleteCommentsForEntity,
  deleteTask as deleteTaskRow,
  getTaskById,
  listTasks,
  prisma,
  updateTask as updateTaskRow,
  type TaskDetail,
  type TaskListItem,
} from '@bond-os/database';
import {
  NotFoundError,
  ROLES,
  ValidationError,
  type CreateTaskInput,
  type PaginatedResult,
  type TaskQuery,
  type UpdateTaskInput,
} from '@bond-os/shared';

/**
 * Dynamically imported at each call site below, not statically at the top
 * of this file — `publishEvent()` transitively reaches the Tool Registry
 * (via `proposeAction`, for an INVOKE_TOOL workflow step), which imports
 * every concrete `*.tool.ts` file, including `create-task.tool.ts`, which
 * imports THIS file's `createTaskService`. A static top-level import here
 * would be a real circular import; a dynamic one defers module loading past
 * both modules' initial evaluation, breaking the cycle while keeping
 * identical synchronous runtime behavior — the same pattern already used by
 * `apps/web/features/agents/lib/base-agent.ts`'s `health()`.
 */
async function getPublishEvent() {
  const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
  return publishEvent;
}

export async function listTasksService(
  organizationId: string,
  query: TaskQuery,
): Promise<PaginatedResult<TaskListItem>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listTasks({ organizationId, ...query });
}

export async function getTaskService(organizationId: string, id: string): Promise<TaskDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  const task = await getTaskById(id, organizationId);
  if (!task) throw new NotFoundError('Task not found.');
  return task;
}

async function assertAssigneeInOrg(organizationId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const valid = await areAllUsersInOrganization([assigneeId], organizationId);
  if (!valid) {
    throw new ValidationError('Assignee must belong to your organization.');
  }
}

async function assertProjectInOrg(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new NotFoundError('Project not found.');
}

export async function createTaskService(organizationId: string, input: CreateTaskInput): Promise<TaskDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  await assertProjectInOrg(organizationId, input.projectId);
  await assertAssigneeInOrg(organizationId, input.assigneeId);

  return createTaskRow({ organizationId, ...input });
}

export async function updateTaskService(
  organizationId: string,
  id: string,
  input: UpdateTaskInput,
): Promise<TaskDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  if (input.projectId) {
    await assertProjectInOrg(organizationId, input.projectId);
  }
  await assertAssigneeInOrg(organizationId, input.assigneeId);

  const updated = await updateTaskRow(id, organizationId, input);
  if (!updated) throw new NotFoundError('Task not found.');

  const publishEvent = await getPublishEvent();
  await publishEvent({
    organizationId,
    eventType: 'task.updated',
    source: 'TASK',
    payload: { taskId: updated.id, projectId: updated.project.id, status: updated.status },
    entityType: 'TASK',
    entityId: updated.id,
  });
  if (updated.status === 'DONE') {
    await publishEvent({
      organizationId,
      eventType: 'task.completed',
      source: 'TASK',
      payload: { taskId: updated.id, projectId: updated.project.id },
      entityType: 'TASK',
      entityId: updated.id,
    });
  }

  return updated;
}

export async function deleteTaskService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteTaskRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Task not found.');
  await deleteCommentsForEntity(organizationId, 'TASK', id);
}
