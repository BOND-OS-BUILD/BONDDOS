import { requireAuth } from '@bond-os/auth';
import type { CreateWorkflowDefinitionData } from '@bond-os/database';
import { createWorkflowDefinitionSchema, workflowDefinitionListQuerySchema } from '@bond-os/shared';

import { getWorkflowDefinitionService } from '@/features/workflows/lib/container';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Workflow Definitions — the org-authored automation catalog (Phase 8). See docs/workflows.md. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, workflowDefinitionListQuerySchema);
  const result = await getWorkflowDefinitionService().list({ organizationId, ...query });
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createWorkflowDefinitionSchema);

  // `body`'s JSON-record fields (`trigger`/`graph`/etc.) are validated
  // `z.record(z.unknown())` shapes from `@bond-os/shared`, which can't
  // structurally satisfy Prisma's `InputJsonValue` — the same
  // `as unknown as Prisma.InputJsonValue` boundary cast used at every other
  // route/service seam that hands a parsed body to a repository call.
  const definition = await getWorkflowDefinitionService().create(
    organizationId,
    user.id,
    body as unknown as Omit<CreateWorkflowDefinitionData, 'organizationId'>,
  );

  return apiSuccess(definition, { status: 201 });
});
