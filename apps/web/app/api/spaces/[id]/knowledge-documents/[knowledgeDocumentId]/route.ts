import { requireAuth } from '@bond-os/auth';

import { unlinkKnowledgeDocumentFromSpaceService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string; knowledgeDocumentId: string }> };

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id, knowledgeDocumentId } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  await unlinkKnowledgeDocumentFromSpaceService(organizationId, user.id, id, knowledgeDocumentId);
  return apiSuccess({ unlinked: true });
});
