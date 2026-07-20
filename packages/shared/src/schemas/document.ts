import { z } from 'zod';

import { paginationQuerySchema } from './query';

export const DOCUMENT_TYPES = ['PDF', 'DOCX', 'PPT', 'SPREADSHEET', 'NOTE', 'OTHER'] as const;
export const documentTypeSchema = z.enum(DOCUMENT_TYPES);

/** Validates the metadata fields submitted alongside the file in a multipart upload. */
export const createDocumentMetadataSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  type: documentTypeSchema.default('OTHER'),
  projectId: z.string().min(1).nullable().optional(),
  meetingId: z.string().min(1).nullable().optional(),
  taskIds: z.array(z.string().min(1)).default([]),
});
export type CreateDocumentMetadataInput = z.infer<typeof createDocumentMetadataSchema>;

/** Metadata-only edits — re-uploading a new file replaces the document instead. */
export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  type: documentTypeSchema.optional(),
  projectId: z.string().min(1).nullable().optional(),
  meetingId: z.string().min(1).nullable().optional(),
  taskIds: z.array(z.string().min(1)).optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const documentQuerySchema = paginationQuerySchema.extend({
  type: documentTypeSchema.optional(),
  projectId: z.string().min(1).optional(),
  meetingId: z.string().min(1).optional(),
  sortBy: z.enum(['title', 'type', 'size', 'createdAt']).default('createdAt'),
});
export type DocumentQuery = z.infer<typeof documentQuerySchema>;
