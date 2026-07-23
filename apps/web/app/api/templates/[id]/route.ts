import { updateTemplateSchema } from '@bond-os/shared';

import {
  deleteTemplateService,
  getTemplateService,
  updateTemplateService,
} from '@/features/templates/services/template.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  return apiSuccess(await getTemplateService(id));
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const body = await parseJsonBody(request, updateTemplateSchema);
  return apiSuccess(await updateTemplateService(id, body));
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  await deleteTemplateService(id);
  return apiSuccess({ id });
});
