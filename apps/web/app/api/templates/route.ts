import { createTemplateSchema, templateTypeSchema } from '@bond-os/shared';

import { createTemplateService, listTemplatesService } from '@/features/templates/services/template.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/** Phase 11 — template marketplace. Browse is MEMBER; create is ADMIN (service). */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (request) => {
  const typeParam = new URL(request.url).searchParams.get('type');
  const type = typeParam ? templateTypeSchema.parse(typeParam) : undefined;
  return apiSuccess(await listTemplatesService(type));
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, createTemplateSchema);
  return apiSuccess(await createTemplateService(body), { status: 201 });
});
