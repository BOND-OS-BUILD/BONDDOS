import { z } from 'zod';

import { paginationQuerySchema } from './query';

export const createContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(200),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.partial();
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const contactQuerySchema = paginationQuerySchema.extend({
  sortBy: z.enum(['name', 'company', 'createdAt']).default('createdAt'),
});
export type ContactQuery = z.infer<typeof contactQuerySchema>;
