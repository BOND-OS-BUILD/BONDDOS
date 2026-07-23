import { customRecordInputSchema, paginationQuerySchema } from '@bond-os/shared';

import {
  createCustomRecordService,
  listCustomRecordsService,
} from '@/features/custom-objects/services/custom-object.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ key: string }> };

export const dynamic = 'force-dynamic';

export const GET = apiHandler<Context>(async (request, { params }) => {
  const { key } = await params;
  const query = parseQueryParams(request, paginationQuerySchema);
  return apiSuccess(
    await listCustomRecordsService(key, { page: query.page, pageSize: query.pageSize, search: query.search }),
  );
});

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { key } = await params;
  const body = await parseJsonBody(request, customRecordInputSchema);
  return apiSuccess(await createCustomRecordService(key, body), { status: 201 });
});
