import { updateMeetingSchema } from '@bond-os/shared';

import {
  deleteMeetingService,
  getMeetingService,
  updateMeetingService,
} from '@/features/meetings/services/meeting.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const meeting = await getMeetingService(organizationId, id);
  return apiSuccess(meeting);
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateMeetingSchema);
  const meeting = await updateMeetingService(organizationId, id, body);
  return apiSuccess(meeting);
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  await deleteMeetingService(organizationId, id);
  return apiSuccess({ id });
});
