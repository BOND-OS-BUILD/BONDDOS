import { requireAuth } from '@bond-os/auth';
import { updateInsightStatusSchema } from '@bond-os/shared';

import { getInsightService } from '@/features/agents/lib/container';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Bookkeeping on the insight row itself only — never modifies domain data. */
export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;
  const body = await parseJsonBody(request, updateInsightStatusSchema);

  if (body.status === 'ACKNOWLEDGED') {
    await getInsightService().acknowledge(id, organizationId);
  } else {
    await getInsightService().dismiss(id, organizationId);
  }

  return apiSuccess({ id, status: body.status });
});
