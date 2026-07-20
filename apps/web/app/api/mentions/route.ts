import { requireAuth } from '@bond-os/auth';
import { mentionListQuerySchema } from '@bond-os/shared';

import { listMentionsForUserService } from '@/features/comments/services/mention.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Every USER-type mention naming the caller, most recent first. See docs/comments.md. */
export const GET = apiHandler(async (request) => {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, mentionListQuerySchema);
  const mentions = await listMentionsForUserService(organizationId, user.id, query.page, query.pageSize);
  return apiSuccess(mentions);
});
