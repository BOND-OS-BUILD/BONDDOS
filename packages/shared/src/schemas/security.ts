import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Phase 10 — Security Dashboard / Admin Console query schemas. */

export const securityEventTypeSchema = z.enum([
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'AUTH_REQUIRED',
  'PERMISSION_DENIED',
  'APPROVAL_FAILED',
  'TOOL_BLOCKED',
  'RATE_LIMIT_EXCEEDED',
  'CROSS_ORG_ATTEMPT',
]);
export type SecurityEventTypeName = z.infer<typeof securityEventTypeSchema>;

export const securityEventQuerySchema = paginationQuerySchema.extend({
  type: securityEventTypeSchema.optional(),
  sinceDays: z.coerce.number().int().positive().max(365).default(30),
});
export type SecurityEventQuery = z.infer<typeof securityEventQuerySchema>;
