import { z } from 'zod';

/** Phase 11 — API key management schemas. */

export const apiKeyTypeSchema = z.enum(['PERSONAL', 'ORGANIZATION']);
export type ApiKeyTypeName = z.infer<typeof apiKeyTypeSchema>;

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'A name is required.').max(120),
  type: apiKeyTypeSchema,
  scopes: z.array(z.string().trim().min(1)).min(1, 'Select at least one scope.').max(50),
  /** Optional expiry; omit for a non-expiring key. */
  expiresInDays: z.number().int().positive().max(3650).optional(),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
