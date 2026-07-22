import { z } from 'zod';

/** Phase 10 — configurable rate-limit policy management schemas. */

export const rateLimitScopeSchema = z.enum(['USER', 'ORGANIZATION', 'API', 'AI', 'TOOL', 'WORKFLOW']);
export type RateLimitScopeName = z.infer<typeof rateLimitScopeSchema>;

export const upsertRateLimitPolicySchema = z.object({
  scope: rateLimitScopeSchema,
  /** Omit (or empty) for the scope's default policy; set to target a specific org/user/route. */
  key: z.string().trim().max(200).optional(),
  limit: z.number().int().positive().max(1_000_000),
  windowSeconds: z.number().int().positive().max(86_400),
  enabled: z.boolean().default(true),
  description: z.string().trim().max(500).optional(),
});
export type UpsertRateLimitPolicyInput = z.infer<typeof upsertRateLimitPolicySchema>;

export const deleteRateLimitPolicySchema = z.object({
  scope: rateLimitScopeSchema,
  key: z.string().trim().max(200).optional(),
});
export type DeleteRateLimitPolicyInput = z.infer<typeof deleteRateLimitPolicySchema>;
