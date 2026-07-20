import { NotFoundError } from '@bond-os/shared';
import type { Prisma, WorkflowDefinitionData } from '@bond-os/database';

import { getWorkflowDefinitionService } from '@/features/workflows/lib/container';

import { WORKFLOW_TEMPLATES } from '../templates/registry';

/**
 * Instantiates a built-in Workflow Template (Phase 8) into a fresh, editable
 * `DRAFT` `WorkflowDefinition` — the one place `WORKFLOW_TEMPLATES` (plain
 * developer-owned data) meets `WorkflowDefinitionService.create()` (the
 * per-organization write path, which already enforces `requireRole` and
 * `validateGraph`). Never auto-publishes: the org reviews/edits the draft
 * (e.g. filling in the template's `REPLACE_WITH_*` placeholders, setting an
 * owner) and calls the existing `publish` endpoint themselves when ready.
 */

export interface InstantiateWorkflowTemplateInput {
  templateKey: string;
  workflowKey: string;
  name?: string;
}

export async function instantiateWorkflowTemplateService(
  organizationId: string,
  userId: string,
  input: InstantiateWorkflowTemplateInput,
): Promise<WorkflowDefinitionData> {
  const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.templateKey === input.templateKey);
  if (!template) throw new NotFoundError(`Workflow template "${input.templateKey}" not found.`);

  return getWorkflowDefinitionService().create(organizationId, userId, {
    workflowKey: input.workflowKey,
    version: '1',
    name: input.name ?? template.name,
    description: template.description,
    triggerType: template.triggerType,
    // Both are plain, hand-typed developer data (not zod-inferred, so TS
    // gives them no implicit index signature) — same `as unknown as
    // Prisma.InputJsonValue` cast `workflow-run.service.ts` already uses for
    // `stepDef.params`/`outcome.output` when handing a typed shape to a
    // repository function that only accepts raw JSON.
    trigger: template.trigger as unknown as Prisma.InputJsonValue,
    graph: template.graph as unknown as Prisma.InputJsonValue,
  });
}
