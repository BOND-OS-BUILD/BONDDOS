import { getAIHealthService } from '@/features/ai/services/ai.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const health = await getAIHealthService(organizationId);
  return apiSuccess(health);
});
