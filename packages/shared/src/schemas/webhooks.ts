import { z } from 'zod';

import { areEventPatternsValid } from '../events';

/** Phase 11 — outbound webhook subscription schemas. */

const eventsField = z
  .array(z.string().trim().min(1))
  .min(1, 'Subscribe to at least one event.')
  .max(64)
  .refine((patterns) => areEventPatternsValid(patterns), {
    message: 'One or more event patterns are not recognized.',
  });

export const createWebhookSchema = z.object({
  url: z.string().url('Enter a valid https URL.').max(2048),
  events: eventsField,
  description: z.string().trim().max(280).optional(),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  url: z.string().url('Enter a valid https URL.').max(2048).optional(),
  events: eventsField.optional(),
  description: z.string().trim().max(280).nullish(),
  enabled: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;
