import { customRecordInputSchema } from '@bond-os/shared';

import {
  deleteCustomRecordService,
  getCustomRecordService,
  updateCustomRecordService,
} from '@/features/custom-objects/services/custom-object.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ key: string; id: string }> };

export const dynamic = 'force-dynamic';

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { key, id } = await params;
  return apiSuccess(await getCustomRecordService(key, id));
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { key, id } = await params;
  const body = await parseJsonBody(request, customRecordInputSchema);
  return apiSuccess(await updateCustomRecordService(key, id, body));
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { key, id } = await params;
  await deleteCustomRecordService(key, id);
  return apiSuccess({ id });
});
