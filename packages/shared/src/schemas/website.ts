import { z } from 'zod';

import { paginationQuerySchema } from './query';

export const createWebsiteSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  url: z.string().trim().url('Enter a valid URL.'),
});
export type CreateWebsiteInput = z.infer<typeof createWebsiteSchema>;

export const updateWebsiteSchema = createWebsiteSchema.partial();
export type UpdateWebsiteInput = z.infer<typeof updateWebsiteSchema>;

export const websiteQuerySchema = paginationQuerySchema.extend({
  sortBy: z.enum(['title', 'createdAt']).default('createdAt'),
});
export type WebsiteQuery = z.infer<typeof websiteQuerySchema>;
