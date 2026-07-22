import { z } from 'zod';

/** Phase 10 — feature-flag management API schemas. */

export const featureFlagScopeSchema = z.enum(['GLOBAL', 'ORGANIZATION', 'USER']);
export type FeatureFlagScopeInput = z.infer<typeof featureFlagScopeSchema>;

export const setFeatureFlagSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Flag key is required.')
      .max(120)
      .regex(/^[a-z0-9._-]+$/i, 'Flag key may only contain letters, numbers, dots, dashes and underscores.'),
    scope: featureFlagScopeSchema,
    /** Required for ORGANIZATION (organizationId) and USER (userId); omit for GLOBAL. */
    scopeId: z.string().trim().min(1).max(200).optional(),
    enabled: z.boolean(),
    description: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope !== 'GLOBAL' && !value.scopeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scopeId'],
        message: 'scopeId is required for ORGANIZATION and USER scopes.',
      });
    }
  });

export type SetFeatureFlagInput = z.infer<typeof setFeatureFlagSchema>;

export const deleteFeatureFlagSchema = z.object({
  key: z.string().trim().min(1).max(120),
  scope: featureFlagScopeSchema,
  scopeId: z.string().trim().min(1).max(200).optional(),
});
export type DeleteFeatureFlagInput = z.infer<typeof deleteFeatureFlagSchema>;
