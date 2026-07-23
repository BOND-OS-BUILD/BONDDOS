import { createFormSchema } from '@bond-os/shared';

import { createFormService, listFormsService } from '@/features/forms/services/form.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/** Phase 11 — dynamic form definitions. Managing is ADMIN (in the service). */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  return apiSuccess(await listFormsService());
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, createFormSchema);
  return apiSuccess(await createFormService(body), { status: 201 });
});
