import { customRecordInputSchema, paginationQuerySchema } from '@bond-os/shared';

import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import {
  createCustomRecordPublic,
  listCustomRecordsPublic,
} from '@/features/api-v1/services/custom-objects-public.service';
import { apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';

type Context = { params: Promise<{ key: string }> };

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler<Context>('custom-objects:read', async (request, apiContext, { params }) => {
  const { key } = await params;
  const query = parseQueryParams(request, paginationQuerySchema);
  return apiSuccess(
    await listCustomRecordsPublic(apiContext.organizationId, key, {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
    }),
  );
});

export const POST = apiV1Handler<Context>('custom-objects:write', async (request, apiContext, { params }) => {
  const { key } = await params;
  const body = await parseJsonBody(request, customRecordInputSchema);
  return apiSuccess(
    await createCustomRecordPublic(apiContext.organizationId, key, body),
    { status: 201 },
  );
});
