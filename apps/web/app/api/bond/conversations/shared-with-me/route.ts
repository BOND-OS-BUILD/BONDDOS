import { requireAuth } from '@bond-os/auth';
import { paginationQuerySchema } from '@bond-os/shared';

import { listConversationsSharedWithMeService } from '@/features/bond/services/conversation.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, paginationQuerySchema.pick({ page: true, pageSize: true }));
  const result = await listConversationsSharedWithMeService(organizationId, user.id, query.page, query.pageSize);
  return apiSuccess(result);
});
