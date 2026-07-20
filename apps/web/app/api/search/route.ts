import { z } from 'zod';

import { searchService } from '@/features/search/services/search.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
});

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const { q } = parseQueryParams(request, searchQuerySchema);
  const results = await searchService(organizationId, q);
  return apiSuccess(results);
});
