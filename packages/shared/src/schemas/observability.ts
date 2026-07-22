import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Phase 10 — error reporting, analytics window, and usage query schemas. */

export const reportClientErrorSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(10_000).optional(),
  url: z.string().max(2000).optional(),
  digest: z.string().max(200).optional(),
});
export type ReportClientErrorInput = z.infer<typeof reportClientErrorSchema>;

export const errorGroupQuerySchema = paginationQuerySchema.extend({
  resolved: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
});
export type ErrorGroupQuery = z.infer<typeof errorGroupQuerySchema>;

export const resolveErrorGroupSchema = z.object({
  id: z.string().min(1),
  resolved: z.boolean(),
});
export type ResolveErrorGroupInput = z.infer<typeof resolveErrorGroupSchema>;

/** Reusable time-window query for analytics/usage/AI-performance endpoints. */
export const analyticsWindowQuerySchema = z.object({
  sinceDays: z.coerce.number().int().positive().max(365).default(30),
});
export type AnalyticsWindowQuery = z.infer<typeof analyticsWindowQuerySchema>;
