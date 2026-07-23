import { updateObjectDefinitionSchema } from '@bond-os/shared';

import {
  deleteCustomObjectService,
  getCustomObjectService,
  updateCustomObjectService,
} from '@/features/custom-objects/services/custom-object.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ key: string }> };

export const dynamic = 'force-dynamic';

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { key } = await params;
  return apiSuccess(await getCustomObjectService(key));
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { key } = await params;
  const body = await parseJsonBody(request, updateObjectDefinitionSchema);
  return apiSuccess(await updateCustomObjectService(key, body));
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { key } = await params;
  await deleteCustomObjectService(key);
  return apiSuccess({ key });
});
