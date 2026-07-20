import { z } from 'zod';

import { paginationQuerySchema } from './query';

export const CUSTOMER_STATUSES = ['LEAD', 'ACTIVE', 'CHURNED', 'ARCHIVED'] as const;
export const customerStatusSchema = z.enum(CUSTOMER_STATUSES);

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(200),
  company: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  website: z.string().trim().url('Website must be a valid URL.').nullable().optional(),
  status: customerStatusSchema.default('LEAD'),
  notes: z.string().trim().max(8000).nullable().optional(),
  projectIds: z.array(z.string().min(1)).default([]),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial();
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const customerQuerySchema = paginationQuerySchema.extend({
  status: customerStatusSchema.optional(),
  sortBy: z.enum(['name', 'status', 'createdAt']).default('createdAt'),
});
export type CustomerQuery = z.infer<typeof customerQuerySchema>;
