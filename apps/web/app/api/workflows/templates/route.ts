import { WORKFLOW_TEMPLATES } from '@/features/workflows/templates/registry';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Built-in Workflow Templates (Phase 8) — lightweight metadata only (no `graph`); see `[key]/instantiate/route.ts` for turning one into an editable draft. */
export const GET = apiHandler(async () => {
  await requireActiveOrganizationId();

  const templates = WORKFLOW_TEMPLATES.map((template) => ({
    templateKey: template.templateKey,
    name: template.name,
    description: template.description,
    triggerType: template.triggerType,
  }));

  return apiSuccess(templates);
});
