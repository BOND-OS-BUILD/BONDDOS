import { updateFormSchema } from '@bond-os/shared';

import { deleteFormService, getFormService, updateFormService } from '@/features/forms/services/form.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ key: string }> };

export const dynamic = 'force-dynamic';

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { key } = await params;
  return apiSuccess(await getFormService(key));
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { key } = await params;
  const body = await parseJsonBody(request, updateFormSchema);
  return apiSuccess(await updateFormService(key, body));
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { key } = await params;
  await deleteFormService(key);
  return apiSuccess({ key });
});
