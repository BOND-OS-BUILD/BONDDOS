import { z } from 'zod';

import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { searchPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess, parseQueryParams } from '@/lib/api-handler';

const searchQuerySchema = z.object({ q: z.string().trim().min(1, 'A `q` query parameter is required.') });

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('search:read', async (request, apiContext) => {
  const { q } = parseQueryParams(request, searchQuerySchema);
  return apiSuccess(await searchPublic(apiContext.organizationId, q));
});
