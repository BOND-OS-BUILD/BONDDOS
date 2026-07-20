import { requireAuth } from '@bond-os/auth';
import { instantiateWorkflowTemplateSchema } from '@bond-os/shared';

import { instantiateWorkflowTemplateService } from '@/features/workflows/services/workflow-template.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ key: string }> };

const instantiateBodySchema = instantiateWorkflowTemplateSchema.omit({ templateKey: true });

/** Turns a built-in Workflow Template into an editable `DRAFT` `WorkflowDefinition` — never auto-publishes. `templateKey` comes from the URL, not the body. */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const { key } = await params;
  const body = await parseJsonBody(request, instantiateBodySchema);

  const definition = await instantiateWorkflowTemplateService(organizationId, user.id, { templateKey: key, ...body });

  return apiSuccess(definition, { status: 201 });
});
