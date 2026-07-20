import { z } from 'zod';

import { paginationQuerySchema } from './query';

export const EMAIL_DIRECTIONS = ['INCOMING', 'OUTGOING'] as const;
export const emailDirectionSchema = z.enum(EMAIL_DIRECTIONS);

export const createEmailSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required.').max(300),
  sender: z.string().trim().min(1, 'Sender is required.').max(320),
  recipient: z.string().trim().min(1, 'Recipient is required.').max(320),
  sentAt: z.coerce.date(),
  direction: emailDirectionSchema,
  customerId: z.string().min(1, 'A customer is required.'),
  projectId: z.string().min(1).nullable().optional(),
});
export type CreateEmailInput = z.infer<typeof createEmailSchema>;

export const updateEmailSchema = createEmailSchema.partial();
export type UpdateEmailInput = z.infer<typeof updateEmailSchema>;

export const emailQuerySchema = paginationQuerySchema.extend({
  direction: emailDirectionSchema.optional(),
  customerId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  sortBy: z.enum(['subject', 'sentAt', 'createdAt']).default('sentAt'),
});
export type EmailQuery = z.infer<typeof emailQuerySchema>;
