import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Which /library tab a document belongs to — DOCUMENT and FILE share one table. */
export const LIBRARY_ENTITY_TYPES = ['DOCUMENT', 'FILE'] as const;
export const libraryEntityTypeSchema = z.enum(LIBRARY_ENTITY_TYPES);

/** Validates the metadata fields submitted alongside the file in a multipart upload. */
export const createKnowledgeDocumentMetadataSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  entityType: libraryEntityTypeSchema.default('DOCUMENT'),
  folderId: z.string().min(1).nullable().optional(),
  tagIds: z.array(z.string().min(1)).default([]),
});
export type CreateKnowledgeDocumentMetadataInput = z.infer<typeof createKnowledgeDocumentMetadataSchema>;

export const updateKnowledgeDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  folderId: z.string().min(1).nullable().optional(),
  tagIds: z.array(z.string().min(1)).optional(),
});
export type UpdateKnowledgeDocumentInput = z.infer<typeof updateKnowledgeDocumentSchema>;

export const knowledgeDocumentQuerySchema = paginationQuerySchema.extend({
  entityType: libraryEntityTypeSchema.optional(),
  folderId: z.string().min(1).optional(),
  sortBy: z.enum(['title', 'size', 'createdAt']).default('createdAt'),
});
export type KnowledgeDocumentQuery = z.infer<typeof knowledgeDocumentQuerySchema>;
