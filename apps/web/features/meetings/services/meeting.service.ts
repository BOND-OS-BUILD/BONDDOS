import { requireRole } from '@bond-os/auth';
import {
  areAllUsersInOrganization,
  createMeeting as createMeetingRow,
  deleteCommentsForEntity,
  deleteMeeting as deleteMeetingRow,
  getMeetingById,
  listMeetings,
  prisma,
  updateMeeting as updateMeetingRow,
  type MeetingDetail,
  type MeetingListItem,
} from '@bond-os/database';
import {
  NotFoundError,
  ROLES,
  ValidationError,
  type CreateMeetingInput,
  type MeetingQuery,
  type PaginatedResult,
  type UpdateMeetingInput,
} from '@bond-os/shared';

/** Dynamically imported, not statically — `publishEvent()` transitively reaches the Tool Registry (via `proposeAction`, for an INVOKE_TOOL workflow step), which imports `create-meeting.tool.ts`, which imports this file. See the identical note in `apps/web/features/tasks/services/task.service.ts`. */
async function getPublishEvent() {
  const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
  return publishEvent;
}

export async function listMeetingsService(
  organizationId: string,
  query: MeetingQuery,
): Promise<PaginatedResult<MeetingListItem>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listMeetings({ organizationId, ...query });
}

export async function getMeetingService(organizationId: string, id: string): Promise<MeetingDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  const meeting = await getMeetingById(id, organizationId);
  if (!meeting) throw new NotFoundError('Meeting not found.');
  return meeting;
}

async function assertAttendeesInOrg(organizationId: string, userIds: string[]) {
  const valid = await areAllUsersInOrganization(userIds, organizationId);
  if (!valid) {
    throw new ValidationError('Attendees must belong to your organization.');
  }
}

async function assertProjectInOrg(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) {
    throw new ValidationError('Project must belong to your organization.');
  }
}

export async function createMeetingService(
  organizationId: string,
  input: CreateMeetingInput,
): Promise<MeetingDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  await assertProjectInOrg(organizationId, input.projectId);
  await assertAttendeesInOrg(organizationId, input.attendeeIds);

  const created = await createMeetingRow({ organizationId, ...input });
  const publishEvent = await getPublishEvent();
  await publishEvent({
    organizationId,
    eventType: 'meeting.created',
    source: 'MEETING',
    payload: { meetingId: created.id, projectId: created.project.id, title: created.title },
    entityType: 'MEETING',
    entityId: created.id,
  });
  return created;
}

export async function updateMeetingService(
  organizationId: string,
  id: string,
  input: UpdateMeetingInput,
): Promise<MeetingDetail> {
  const { session } = await requireRole(organizationId, ROLES.MEMBER);
  if (input.projectId) {
    await assertProjectInOrg(organizationId, input.projectId);
  }
  await assertAttendeesInOrg(organizationId, input.attendeeIds ?? []);

  const updated = await updateMeetingRow(id, organizationId, { ...input, editedById: session.user.id });
  if (!updated) throw new NotFoundError('Meeting not found.');

  const publishEvent = await getPublishEvent();
  await publishEvent({
    organizationId,
    eventType: 'meeting.updated',
    source: 'MEETING',
    payload: { meetingId: updated.id, projectId: updated.project.id, title: updated.title },
    entityType: 'MEETING',
    entityId: updated.id,
  });

  return updated;
}

export async function deleteMeetingService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteMeetingRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Meeting not found.');
  await deleteCommentsForEntity(organizationId, 'MEETING', id);
}
