import { z } from 'zod';

export const createTagSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(60),
  color: z.string().trim().max(20).nullable().optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;
