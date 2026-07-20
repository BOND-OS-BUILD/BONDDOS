import { requireRole } from '@bond-os/auth';
import {
  areAllUsersInOrganization,
  createProject as createProjectRow,
  deleteCommentsForEntity,
  deleteProject as deleteProjectRow,
  getProjectById,
  listProjects,
  updateProject as updateProjectRow,
  type ProjectDetail,
  type ProjectListItem,
} from '@bond-os/database';
import {
  NotFoundError,
  ROLES,
  ValidationError,
  type CreateProjectInput,
  type PaginatedResult,
  type ProjectQuery,
  type UpdateProjectInput,
} from '@bond-os/shared';

/** Dynamically imported, not statically — see the identical note in `apps/web/features/tasks/services/task.service.ts` (`publishEvent` transitively reaches the Tool Registry, which imports `create-project.tool.ts`, which imports this file). */
async function getPublishEvent() {
  const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
  return publishEvent;
}

export async function listProjectsService(
  organizationId: string,
  query: ProjectQuery,
): Promise<PaginatedResult<ProjectListItem>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listProjects({ organizationId, ...query });
}

export async function getProjectService(organizationId: string, id: string): Promise<ProjectDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  const project = await getProjectById(id, organizationId);
  if (!project) throw new NotFoundError('Project not found.');
  return project;
}

async function assertAssigneesInOrg(organizationId: string, userIds: string[]) {
  const valid = await areAllUsersInOrganization(userIds, organizationId);
  if (!valid) {
    throw new ValidationError('Owner and members must belong to your organization.');
  }
}

export async function createProjectService(
  organizationId: string,
  input: CreateProjectInput,
): Promise<ProjectDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  await assertAssigneesInOrg(organizationId, [
    ...(input.ownerId ? [input.ownerId] : []),
    ...input.memberIds,
  ]);

  const created = await createProjectRow({ organizationId, ...input });
  const publishEvent = await getPublishEvent();
  await publishEvent({
    organizationId,
    eventType: 'project.created',
    source: 'PROJECT',
    payload: { projectId: created.id, title: created.title, status: created.status },
    entityType: 'PROJECT',
    entityId: created.id,
  });
  return created;
}

export async function updateProjectService(
  organizationId: string,
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectDetail> {
  const { session } = await requireRole(organizationId, ROLES.MEMBER);
  await assertAssigneesInOrg(organizationId, [
    ...(input.ownerId ? [input.ownerId] : []),
    ...(input.memberIds ?? []),
  ]);

  const updated = await updateProjectRow(id, organizationId, { ...input, editedById: session.user.id });
  if (!updated) throw new NotFoundError('Project not found.');

  const publishEvent = await getPublishEvent();
  await publishEvent({
    organizationId,
    eventType: 'project.updated',
    source: 'PROJECT',
    payload: { projectId: updated.id, title: updated.title, status: updated.status },
    entityType: 'PROJECT',
    entityId: updated.id,
  });

  return updated;
}

export async function deleteProjectService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteProjectRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Project not found.');
  await deleteCommentsForEntity(organizationId, 'PROJECT', id);
}
