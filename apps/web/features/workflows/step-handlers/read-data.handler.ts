import {
  getCustomerById,
  getDocumentById,
  getKnowledgeDocumentById,
  getMeetingById,
  getProjectById,
  getTaskById,
} from '@bond-os/database';
import { NotFoundError, ValidationError } from '@bond-os/shared';

import type { WorkflowStepHandler, WorkflowStepHandlerContext } from '../lib/step-handler';

/**
 * READ_DATA — reads one record by type + id. Calls `@bond-os/database`
 * repository functions directly, not the feature service layer
 * (`getProjectService` etc.) — those services are transitively reachable
 * FROM this workflow engine (via `proposeAction`'s Tool Registry, for an
 * INVOKE_TOOL step), so importing them here would close a real circular
 * import. `ctx.organizationId` is already trusted by this point (it always
 * originates from an already-authenticated write, a secret-verified tick,
 * or a signature-verified webhook — see docs/workflows.md) so no redundant
 * `requireRole` re-check happens per read, matching how `observeForAgent`
 * (Phase 7) makes the same call for the same reason.
 */

type EntityType = 'project' | 'task' | 'meeting' | 'customer' | 'document' | 'knowledgeDocument';

const READERS: Record<EntityType, (id: string, organizationId: string) => Promise<unknown | null>> = {
  project: getProjectById,
  task: getTaskById,
  meeting: getMeetingById,
  customer: getCustomerById,
  document: getDocumentById,
  knowledgeDocument: getKnowledgeDocumentById,
};

function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && value in READERS;
}

export const readDataHandler: WorkflowStepHandler = {
  stepType: 'READ_DATA',
  async execute(ctx: WorkflowStepHandlerContext, params) {
    const entityType = params.entityType;
    const id = params.id;
    if (!isEntityType(entityType)) throw new ValidationError(`READ_DATA: unknown entityType "${String(entityType)}".`);
    if (typeof id !== 'string' || !id) throw new ValidationError('READ_DATA: "id" is required.');

    const record = await READERS[entityType](id, ctx.organizationId);
    if (!record) throw new NotFoundError(`READ_DATA: ${entityType} "${id}" not found.`);

    return { kind: 'succeeded', output: { record } };
  },
};
