import { useTemplateSchema } from '@bond-os/shared';

import { useTemplateService } from '@/features/templates/services/template.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

/** Phase 11 — instantiate (import) a template into a live resource. */
export const dynamic = 'force-dynamic';

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const body = await parseJsonBody(request, useTemplateSchema);
  return apiSuccess(await useTemplateService(id, body));
});
