import { areAllUsersInOrganization, deleteTask, prisma, type TaskDetail } from '@bond-os/database';
import { createTaskSchema, NotFoundError, ROLES, type CreateTaskInput } from '@bond-os/shared';
import { z } from 'zod';

import { createTaskService } from '@/features/tasks/services/task.service';

import type { ToolDefinition } from '../lib/tool-definition';

/** Thin wrapper over the existing, unmodified `createTaskService`. Its `projectId` param is the natural dependency-chain target for `$steps.<create_project_step>.output.id` references — see docs/planner.md. */

const outputSchema = z.object({ id: z.string(), title: z.string() });
type Output = z.infer<typeof outputSchema>;

export const createTaskTool: ToolDefinition<CreateTaskInput, Output> = {
  toolKey: 'create_task',
  version: '1',
  name: 'create_task',
  displayName: 'Create Task',
  description: 'Creates a new task under a project.',
  category: 'TASKS',
  icon: 'ListTodo',
  estimatedExecutionMs: 1200,
  rollbackSupport: 'AUTOMATIC',
  supportsPreview: true,
  supportsDryRun: true,
  supportsTransactions: true,
  requiresApproval: true,

  schema: () => ({ parameters: createTaskSchema, output: outputSchema }),
  permissions: () => ROLES.MEMBER,

  async estimate() {
    return 1200;
  },

  async validate(ctx, params) {
    const errors: string[] = [];

    const project = await prisma.project.findFirst({ where: { id: params.projectId, organizationId: ctx.organizationId } });
    if (!project) errors.push('The referenced project was not found in your organization.');

    if (params.assigneeId && !(await areAllUsersInOrganization([params.assigneeId], ctx.organizationId))) {
      errors.push('Assignee must belong to your organization.');
    }

    return { valid: errors.length === 0, errors };
  },

  async preview(_ctx, params) {
    return {
      summary: `Create task "${params.title}"`,
      changes: [
        { field: 'title', before: null, after: params.title },
        { field: 'status', before: null, after: params.status },
        { field: 'projectId', before: null, after: params.projectId },
      ],
    };
  },

  async execute(ctx, params): Promise<Output> {
    const created: TaskDetail = await createTaskService(ctx.organizationId, params);
    return { id: created.id, title: created.title };
  },

  async rollback(ctx, result) {
    // `deleteTask` resolves `false` (never throws) on a zero-row match —
    // throwing here surfaces that as a FAILED rollback step instead of
    // silently recording success for a delete that did nothing.
    const deleted = await deleteTask(result.id, ctx.organizationId);
    if (!deleted) throw new NotFoundError(`Task "${result.title}" no longer exists — rollback could not verify it was removed.`);
  },

  describe(params) {
    return `Create task "${params.title}"`;
  },
};
