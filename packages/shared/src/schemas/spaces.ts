import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Team Spaces (Phase 9) — curation and grouping, not a parallel ACL. See docs/spaces.md. */

export const createSpaceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;

export const spaceListQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  mine: z.coerce.boolean().optional(),
});
export type SpaceListQuery = z.infer<typeof spaceListQuerySchema>;

export const addSpaceMemberSchema = z.object({ userId: z.string().min(1) });
export type AddSpaceMemberInput = z.infer<typeof addSpaceMemberSchema>;

export const linkSpaceProjectSchema = z.object({ projectId: z.string().min(1) });
export type LinkSpaceProjectInput = z.infer<typeof linkSpaceProjectSchema>;

export const linkSpaceKnowledgeDocumentSchema = z.object({ knowledgeDocumentId: z.string().min(1) });
export type LinkSpaceKnowledgeDocumentInput = z.infer<typeof linkSpaceKnowledgeDocumentSchema>;

export const linkSpaceWorkflowSchema = z.object({ workflowDefinitionId: z.string().min(1) });
export type LinkSpaceWorkflowInput = z.infer<typeof linkSpaceWorkflowSchema>;

export const linkSpaceAgentSchema = z.object({ agentKey: z.string().min(1) });
export type LinkSpaceAgentInput = z.infer<typeof linkSpaceAgentSchema>;
