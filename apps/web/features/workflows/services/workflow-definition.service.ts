import { requireRole } from '@bond-os/auth';
import {
  createWorkflowDefinition,
  disableWorkflowDefinition,
  getLatestActiveWorkflowDefinition,
  getWorkflowDefinitionById,
  listWorkflowDefinitions,
  publishWorkflowDefinition,
  updateDraftWorkflowDefinition,
  type CreateWorkflowDefinitionData,
  type ListWorkflowDefinitionsFilters,
  type TriggerType,
  type UpdateDraftWorkflowDefinitionData,
  type WorkflowDefinitionData,
} from '@bond-os/database';
import { NotFoundError, ROLES, ValidationError, type PaginatedResult } from '@bond-os/shared';

import { validatePlanSteps } from '@/features/planner/lib/dag';

import type { WorkflowGraphDefinition } from '../lib/workflow-graph';
import { getWorkflowStepHandlerRegistry } from '../registry';

const WRITE_STEP_TYPES = new Set(['INVOKE_TOOL', 'INVOKE_AGENT']);

/**
 * Organization-authored workflow definitions (Phase 8) — every method here
 * takes `organizationId` and calls `requireRole`, unlike `tools.ts`/
 * `agents.ts`'s services (globally-registered developer code). See
 * docs/workflows.md.
 */
export class WorkflowDefinitionService {
  async create(
    organizationId: string,
    userId: string,
    input: Omit<CreateWorkflowDefinitionData, 'organizationId'>,
  ): Promise<WorkflowDefinitionData> {
    await requireRole(organizationId, ROLES.MEMBER);
    this.validateGraph(input.graph);
    return createWorkflowDefinition({ ...input, organizationId, ownerId: input.ownerId ?? userId });
  }

  async get(id: string, organizationId: string): Promise<WorkflowDefinitionData> {
    await requireRole(organizationId, ROLES.MEMBER);
    const definition = await getWorkflowDefinitionById(id, organizationId);
    if (!definition) throw new NotFoundError('Workflow not found.');
    return definition;
  }

  async list(filters: ListWorkflowDefinitionsFilters): Promise<PaginatedResult<WorkflowDefinitionData>> {
    await requireRole(filters.organizationId, ROLES.MEMBER);
    return listWorkflowDefinitions(filters);
  }

  async updateDraft(id: string, organizationId: string, data: UpdateDraftWorkflowDefinitionData): Promise<WorkflowDefinitionData> {
    await requireRole(organizationId, ROLES.MEMBER);
    if (data.graph) this.validateGraph(data.graph);

    const updated = await updateDraftWorkflowDefinition(id, organizationId, data);
    if (!updated) throw new NotFoundError('Draft workflow not found (it may already be published).');
    return this.get(id, organizationId);
  }

  /** Freezes a DRAFT into an immutable, versioned ACTIVE row — requires an owner if the graph contains any write step (INVOKE_TOOL/INVOKE_AGENT), since those need an accountable party for `proposeAction`. */
  async publish(id: string, organizationId: string): Promise<WorkflowDefinitionData> {
    await requireRole(organizationId, ROLES.MEMBER);

    const definition = await getWorkflowDefinitionById(id, organizationId);
    if (!definition) throw new NotFoundError('Workflow not found.');
    if (definition.status !== 'DRAFT') throw new ValidationError('Only a DRAFT workflow can be published.');

    const graph = definition.graph as unknown as WorkflowGraphDefinition;
    const hasWriteStep = graph.steps.some((step) => WRITE_STEP_TYPES.has(step.stepType));
    if (hasWriteStep && !definition.ownerId) {
      throw new ValidationError('This workflow proposes writes (INVOKE_TOOL/INVOKE_AGENT) and needs an owner before it can be published.');
    }

    const published = await publishWorkflowDefinition(id, organizationId);
    if (!published) throw new NotFoundError('Draft workflow not found (it may already be published).');
    return this.get(id, organizationId);
  }

  async disable(id: string, organizationId: string): Promise<void> {
    await requireRole(organizationId, ROLES.MEMBER);
    const disabled = await disableWorkflowDefinition(id, organizationId);
    if (!disabled) throw new NotFoundError('Active workflow not found.');
  }

  async getLatestActive(organizationId: string, workflowKey: string): Promise<WorkflowDefinitionData | null> {
    await requireRole(organizationId, ROLES.MEMBER);
    return getLatestActiveWorkflowDefinition(organizationId, workflowKey);
  }

  /** Validates the graph is a well-formed DAG (`dag.ts`'s own cycle/duplicate/unknown-dependency checks) and every step names a registered handler — before this workflow can ever be published or run against, not discovered mid-execution. */
  private validateGraph(graphInput: unknown): void {
    const graph = graphInput as unknown as WorkflowGraphDefinition;
    if (!graph || !Array.isArray(graph.steps) || graph.steps.length === 0) {
      throw new ValidationError('A workflow graph must have at least one step.');
    }
    validatePlanSteps(graph.steps);

    const registry = getWorkflowStepHandlerRegistry();
    for (const step of graph.steps) {
      if (!registry.get(step.stepType)) {
        throw new ValidationError(`Unknown step type "${step.stepType}" for step "${step.key}".`);
      }
    }
  }
}

export type { TriggerType };
