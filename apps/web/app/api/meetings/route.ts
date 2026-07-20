import { createMeetingSchema, meetingQuerySchema } from '@bond-os/shared';

import { createMeetingService, listMeetingsService } from '@/features/meetings/services/meeting.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, meetingQuerySchema);
  const result = await listMeetingsService(organizationId, query);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createMeetingSchema);
  const meeting = await createMeetingService(organizationId, body);
  return apiSuccess(meeting, { status: 201 });
});
