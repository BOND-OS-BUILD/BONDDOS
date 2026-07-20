import { getEntityDetailService } from '@/features/graph/services/graph.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Full detail for the Entity Viewer page: node + every relationship + the first page of its timeline. */
export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const detail = await getEntityDetailService(organizationId, id);
  return apiSuccess(detail);
});
