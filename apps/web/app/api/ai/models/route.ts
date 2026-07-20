import { listAIModelsService } from '@/features/ai/services/ai.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const models = await listAIModelsService(organizationId);
  return apiSuccess(models);
});
