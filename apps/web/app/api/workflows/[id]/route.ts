import type { UpdateDraftWorkflowDefinitionData } from '@bond-os/database';
import { updateDraftWorkflowDefinitionSchema } from '@bond-os/shared';

import { getWorkflowDefinitionService } from '@/features/workflows/lib/container';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;

  const definition = await getWorkflowDefinitionService().get(id, organizationId);

  return apiSuccess(definition);
});

/** Only ever touches a `DRAFT` row — see `WorkflowDefinitionService.updateDraft`. */
export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;
  const body = await parseJsonBody(request, updateDraftWorkflowDefinitionSchema);

  // See the matching comment in `../route.ts` re: the JSON-record boundary cast.
  const definition = await getWorkflowDefinitionService().updateDraft(
    id,
    organizationId,
    body as unknown as UpdateDraftWorkflowDefinitionData,
  );

  return apiSuccess(definition);
});
