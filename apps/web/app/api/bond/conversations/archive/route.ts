import { archiveConversationsSchema } from '@bond-os/shared';

import { archiveOldConversationsService } from '@/features/bond/services/conversation.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Manual "Archive old conversations" admin action (spec §5's memory expiration). */
export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, archiveConversationsSchema);
  const archivedCount = await archiveOldConversationsService(organizationId, body.olderThanDays);
  return apiSuccess({ archivedCount });
});
