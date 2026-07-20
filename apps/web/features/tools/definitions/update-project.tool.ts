import { prisma, updateProject, type ProjectStatus, type Priority } from '@bond-os/database';
import { NotFoundError, prioritySchema, projectStatusSchema, ROLES } from '@bond-os/shared';
import { z } from 'zod';

import { updateProjectService } from '@/features/projects/services/project.service';

import type { ToolDefinition } from '../lib/tool-definition';

/**
 * Looks the target project up by `lookupTitle` rather than requiring a
 * caller-supplied id — this is what lets the Planner's IF-EXISTS/ELSE
 * template (see `apps/web/features/planner/services/planner.service.ts`)
 * build a valid `update_project` step without knowing the existing
 * project's id at plan-build time, only that one exists by that title.
 */

const paramsSchema = z.object({
  lookupTitle: z.string().trim().min(1, 'A project title is required.'),
  description: z.string().trim().max(4000).nullable().optional(),
  status: projectStatusSchema.optional(),
  priority: prioritySchema.optional(),
});
type Params = z.infer<typeof paramsSchema>;

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  before: z.object({
    description: z.string().nullable(),
    status: z.string(),
    priority: z.string(),
  }),
});
type Output = z.infer<typeof outputSchema>;

async function findProjectByTitle(organizationId: string, title: string) {
  return prisma.project.findFirst({ where: { organizationId, title } });
}

export const updateProjectTool: ToolDefinition<Params, Output> = {
  toolKey: 'update_project',
  version: '1',
  name: 'update_project',
  displayName: 'Update Project',
  description: 'Updates an existing project, found by its exact title.',
  category: 'PROJECTS',
  icon: 'FolderKanban',
  estimatedExecutionMs: 1200,
  rollbackSupport: 'AUTOMATIC',
  supportsPreview: true,
  supportsDryRun: true,
  supportsTransactions: true,
  requiresApproval: true,

  schema: () => ({ parameters: paramsSchema, output: outputSchema }),
  permissions: () => ROLES.MEMBER,

  async estimate() {
    return 1200;
  },

  async validate(ctx, params) {
    const project = await findProjectByTitle(ctx.organizationId, params.lookupTitle);
    if (!project) return { valid: false, errors: [`No project found with title "${params.lookupTitle}".`] };
    return { valid: true, errors: [] };
  },

  async preview(ctx, params) {
    const project = await findProjectByTitle(ctx.organizationId, params.lookupTitle);
    if (!project) throw new NotFoundError(`No project found with title "${params.lookupTitle}".`);

    const changes = [];
    if (params.description !== undefined) changes.push({ field: 'description', before: project.description, after: params.description });
    if (params.status !== undefined) changes.push({ field: 'status', before: project.status, after: params.status });
    if (params.priority !== undefined) changes.push({ field: 'priority', before: project.priority, after: params.priority });

    return { summary: `Update project "${project.title}"`, changes };
  },

  async execute(ctx, params): Promise<Output> {
    const project = await findProjectByTitle(ctx.organizationId, params.lookupTitle);
    if (!project) throw new NotFoundError(`No project found with title "${params.lookupTitle}".`);

    const before = { description: project.description, status: project.status, priority: project.priority };

    const updated = await updateProjectService(ctx.organizationId, project.id, {
      description: params.description,
      status: params.status,
      priority: params.priority,
    });

    return { id: updated.id, title: updated.title, before };
  },

  async rollback(ctx, result) {
    // The raw `updateProject` runs inside a transaction and resolves `null`
    // (never throws) on a zero-row match — throwing here surfaces that as a
    // FAILED rollback step instead of silently recording a restore that
    // didn't actually happen (e.g. the project was renamed or removed out
    // from under this execution between execute() and rollback()).
    const restored = await updateProject(result.id, ctx.organizationId, {
      description: result.before.description,
      status: result.before.status as ProjectStatus,
      priority: result.before.priority as Priority,
    });
    if (!restored) throw new NotFoundError(`Project "${result.title}" no longer exists — rollback could not restore it.`);
  },

  describe(params) {
    return `Update project "${params.lookupTitle}"`;
  },
};
