import { getGoalService } from '@/features/agents/lib/container';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;

  const result = await getGoalService().getGoal(id, organizationId);

  return apiSuccess(result);
});
