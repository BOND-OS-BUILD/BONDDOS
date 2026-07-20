import { areAllUsersInOrganization, deleteProject, type ProjectDetail } from '@bond-os/database';
import { createProjectSchema, NotFoundError, ROLES, type CreateProjectInput } from '@bond-os/shared';
import { z } from 'zod';

import { createProjectService } from '@/features/projects/services/project.service';

import type { ToolDefinition } from '../lib/tool-definition';

/** Thin wrapper over the existing, unmodified `createProjectService` — this tool adds validation/preview/rollback semantics around a call that already exists, it does not duplicate business logic. */

const outputSchema = z.object({ id: z.string(), title: z.string() });
type Output = z.infer<typeof outputSchema>;

export const createProjectTool: ToolDefinition<CreateProjectInput, Output> = {
  toolKey: 'create_project',
  version: '1',
  name: 'create_project',
  displayName: 'Create Project',
  description: 'Creates a new project in the company database.',
  category: 'PROJECTS',
  icon: 'FolderKanban',
  estimatedExecutionMs: 1500,
  rollbackSupport: 'AUTOMATIC',
  supportsPreview: true,
  supportsDryRun: true,
  supportsTransactions: true,
  requiresApproval: true,

  schema: () => ({ parameters: createProjectSchema, output: outputSchema }),
  permissions: () => ROLES.MEMBER,

  async estimate() {
    return 1500;
  },

  async validate(ctx, params) {
    const errors: string[] = [];
    const idsToCheck = [...(params.ownerId ? [params.ownerId] : []), ...params.memberIds];
    if (idsToCheck.length > 0 && !(await areAllUsersInOrganization(idsToCheck, ctx.organizationId))) {
      errors.push('Owner and members must belong to your organization.');
    }
    return { valid: errors.length === 0, errors };
  },

  async preview(_ctx, params) {
    return {
      summary: `Create project "${params.title}"`,
      changes: [
        { field: 'title', before: null, after: params.title },
        { field: 'status', before: null, after: params.status },
        { field: 'priority', before: null, after: params.priority },
        ...(params.description ? [{ field: 'description', before: null, after: params.description }] : []),
      ],
    };
  },

  async execute(ctx, params): Promise<Output> {
    const created: ProjectDetail = await createProjectService(ctx.organizationId, params);
    return { id: created.id, title: created.title };
  },

  async rollback(ctx, result) {
    // Deletes via the raw repository function, not the ADMIN-gated
    // `deleteProjectService` — this tool's own approval tier is MEMBER, and
    // rollback authorization was already established by the plan's original
    // approval, not a fresh independent delete request.
    const deleted = await deleteProject(result.id, ctx.organizationId);
    // `deleteProject` resolves `false` (never throws) on a zero-row match —
    // e.g. the project was already removed by something else before
    // rollback ran. Throwing here is what lets RollbackService's own
    // try/catch actually surface this as a FAILED rollback step instead of
    // silently recording success for a delete that did nothing.
    if (!deleted) throw new NotFoundError(`Project "${result.title}" no longer exists — rollback could not verify it was removed.`);
  },

  describe(params) {
    return `Create project "${params.title}"`;
  },
};
