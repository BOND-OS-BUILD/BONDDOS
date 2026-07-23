import { submitFormSchema } from '@bond-os/shared';

import { submitFormService } from '@/features/forms/services/form.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ key: string }> };

/** Phase 11 — submit a form. Validates against the field set; may create a custom record. */
export const dynamic = 'force-dynamic';

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { key } = await params;
  const body = await parseJsonBody(request, submitFormSchema);
  return apiSuccess(await submitFormService(key, body));
});
