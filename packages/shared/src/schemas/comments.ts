import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Universal comments (Phase 9). See docs/comments.md. */

export const COMMENTABLE_ENTITY_TYPES = ['PROJECT', 'TASK', 'MEETING', 'DOCUMENT', 'CUSTOMER', 'GRAPH_NODE'] as const;
export const commentableEntityTypeSchema = z.enum(COMMENTABLE_ENTITY_TYPES);
export type CommentableEntityTypeInput = z.infer<typeof commentableEntityTypeSchema>;

export const createCommentSchema = z.object({
  entityType: commentableEntityTypeSchema,
  entityId: z.string().min(1),
  content: z.string().trim().min(1, 'Comment cannot be empty.').max(10_000),
  parentCommentId: z.string().min(1).optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1, 'Comment cannot be empty.').max(10_000),
});
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

export const commentListQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  entityType: commentableEntityTypeSchema,
  entityId: z.string().min(1),
});
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;

export const mentionListQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true });
export type MentionListQuery = z.infer<typeof mentionListQuerySchema>;
