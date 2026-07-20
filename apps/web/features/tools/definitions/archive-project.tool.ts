import { prisma, updateProject, type ProjectStatus } from '@bond-os/database';
import { NotFoundError, ROLES, ValidationError } from '@bond-os/shared';
import { z } from 'zod';

import { updateProjectService } from '@/features/projects/services/project.service';

import type { ToolDefinition } from '../lib/tool-definition';

/**
 * ADMIN-tier reference tool — demonstrates the permission-tier computation
 * described in docs/approvals.md: a plan mixing this with a MEMBER-tier
 * tool requires ADMIN to approve the whole plan, not just this step.
 */

const paramsSchema = z.object({
  title: z.string().trim().min(1, 'A project title is required.'),
});
type Params = z.infer<typeof paramsSchema>;

const outputSchema = z.object({ id: z.string(), title: z.string(), previousStatus: z.string() });
type Output = z.infer<typeof outputSchema>;

async function findProjectByTitle(organizationId: string, title: string) {
  return prisma.project.findFirst({ where: { organizationId, title } });
}

export const archiveProjectTool: ToolDefinition<Params, Output> = {
  toolKey: 'archive_project',
  version: '1',
  name: 'archive_project',
  displayName: 'Archive Project',
  description: 'Archives an existing project, found by its exact title.',
  category: 'PROJECTS',
  icon: 'Archive',
  estimatedExecutionMs: 1000,
  rollbackSupport: 'AUTOMATIC',
  supportsPreview: true,
  supportsDryRun: true,
  supportsTransactions: true,
  requiresApproval: true,

  schema: () => ({ parameters: paramsSchema, output: outputSchema }),
  permissions: () => ROLES.ADMIN,

  async estimate() {
    return 1000;
  },

  async validate(ctx, params) {
    const project = await findProjectByTitle(ctx.organizationId, params.title);
    if (!project) return { valid: false, errors: [`No project found with title "${params.title}".`] };
    if (project.status === 'ARCHIVED') return { valid: false, errors: [`Project "${params.title}" is already archived.`] };
    return { valid: true, errors: [] };
  },

  async preview(ctx, params) {
    const project = await findProjectByTitle(ctx.organizationId, params.title);
    if (!project) throw new NotFoundError(`No project found with title "${params.title}".`);
    return {
      summary: `Archive project "${project.title}"`,
      changes: [{ field: 'status', before: project.status, after: 'ARCHIVED' }],
    };
  },

  async execute(ctx, params): Promise<Output> {
    const project = await findProjectByTitle(ctx.organizationId, params.title);
    if (!project) throw new NotFoundError(`No project found with title "${params.title}".`);
    if (project.status === 'ARCHIVED') throw new ValidationError(`Project "${params.title}" is already archived.`);

    const previousStatus = project.status;
    const updated = await updateProjectService(ctx.organizationId, project.id, { status: 'ARCHIVED' });

    return { id: updated.id, title: updated.title, previousStatus };
  },

  async rollback(ctx, result) {
    // Zero-row match resolves `null`, never throws — throwing here surfaces
    // that as a FAILED rollback step instead of silently recording a
    // restore that didn't actually happen.
    const restored = await updateProject(result.id, ctx.organizationId, { status: result.previousStatus as ProjectStatus });
    if (!restored) throw new NotFoundError(`Project "${result.title}" no longer exists — rollback could not restore it.`);
  },

  describe(params) {
    return `Archive project "${params.title}"`;
  },
};
