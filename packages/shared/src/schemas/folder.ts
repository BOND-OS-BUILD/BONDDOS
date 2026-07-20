import { z } from 'zod';

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  parentFolderId: z.string().min(1).nullable().optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
