import { z } from 'zod';

/** Phase 11 — template marketplace schemas. */

export const templateTypeSchema = z.enum([
  'WORKFLOW',
  'AI_PROMPT',
  'PROJECT',
  'DOCUMENT',
  'KNOWLEDGE_GRAPH_VIEW',
  'DASHBOARD',
]);
export type TemplateTypeName = z.infer<typeof templateTypeSchema>;

const KEY_RE = /^[a-z][a-z0-9_-]*$/;

export const createTemplateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(KEY_RE, 'Use a lowercase key: letters, numbers, hyphens and underscores.'),
  name: z.string().trim().min(1, 'A name is required.').max(140),
  description: z.string().trim().max(600).optional(),
  type: templateTypeSchema,
  content: z.unknown(),
  isPublic: z.boolean().default(false),
  version: z.string().trim().max(20).optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(600).nullish(),
  content: z.unknown().optional(),
  isPublic: z.boolean().optional(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

/** Options when instantiating a template into a live resource. */
export const useTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});
export type UseTemplateInput = z.infer<typeof useTemplateSchema>;
