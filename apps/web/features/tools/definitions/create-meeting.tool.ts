import { areAllUsersInOrganization, deleteMeeting, prisma, type MeetingDetail } from '@bond-os/database';
import { createMeetingSchema, NotFoundError, ROLES, type CreateMeetingInput } from '@bond-os/shared';
import { z } from 'zod';

import { createMeetingService } from '@/features/meetings/services/meeting.service';

import type { ToolDefinition } from '../lib/tool-definition';

/** Thin wrapper over the existing, unmodified `createMeetingService` — the sequential tail of the create_project -> create_task(s) -> create_meeting reference chain (see docs/planner.md). */

const outputSchema = z.object({ id: z.string(), title: z.string() });
type Output = z.infer<typeof outputSchema>;

export const createMeetingTool: ToolDefinition<CreateMeetingInput, Output> = {
  toolKey: 'create_meeting',
  version: '1',
  name: 'create_meeting',
  displayName: 'Create Meeting',
  description: 'Schedules a new meeting under a project.',
  category: 'MEETINGS',
  icon: 'Video',
  estimatedExecutionMs: 1200,
  rollbackSupport: 'AUTOMATIC',
  supportsPreview: true,
  supportsDryRun: true,
  supportsTransactions: true,
  requiresApproval: true,

  schema: () => ({ parameters: createMeetingSchema, output: outputSchema }),
  permissions: () => ROLES.MEMBER,

  async estimate() {
    return 1200;
  },

  async validate(ctx, params) {
    const errors: string[] = [];

    const project = await prisma.project.findFirst({ where: { id: params.projectId, organizationId: ctx.organizationId } });
    if (!project) errors.push('The referenced project was not found in your organization.');

    if (params.attendeeIds.length > 0 && !(await areAllUsersInOrganization(params.attendeeIds, ctx.organizationId))) {
      errors.push('All attendees must belong to your organization.');
    }

    return { valid: errors.length === 0, errors };
  },

  async preview(_ctx, params) {
    return {
      summary: `Schedule meeting "${params.title}"`,
      changes: [
        { field: 'title', before: null, after: params.title },
        { field: 'meetingDate', before: null, after: params.meetingDate },
        { field: 'projectId', before: null, after: params.projectId },
      ],
    };
  },

  async execute(ctx, params): Promise<Output> {
    const created: MeetingDetail = await createMeetingService(ctx.organizationId, params);
    return { id: created.id, title: created.title };
  },

  async rollback(ctx, result) {
    // `deleteMeeting` resolves `false` (never throws) on a zero-row match —
    // throwing here surfaces that as a FAILED rollback step instead of
    // silently recording success for a delete that did nothing.
    const deleted = await deleteMeeting(result.id, ctx.organizationId);
    if (!deleted) throw new NotFoundError(`Meeting "${result.title}" no longer exists — rollback could not verify it was removed.`);
  },

  describe(params) {
    return `Schedule meeting "${params.title}"`;
  },
};
