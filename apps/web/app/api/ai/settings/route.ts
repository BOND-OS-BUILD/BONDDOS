import { requireAuth } from '@bond-os/auth';
import { updateOrganizationAiSettingsSchema } from '@bond-os/shared';

import {
  getOrganizationAiSettingsService,
  updateOrganizationAiSettingsService,
} from '@/features/bond/services/ai-settings.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const result = await getOrganizationAiSettingsService(organizationId);
  return apiSuccess(result);
});

export const PATCH = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const { user } = await requireAuth();
  const body = await parseJsonBody(request, updateOrganizationAiSettingsSchema);
  const result = await updateOrganizationAiSettingsService(organizationId, user.id, body);
  return apiSuccess(result);
});
