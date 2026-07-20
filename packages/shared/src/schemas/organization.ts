import { z } from 'zod';

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug must be at least 2 characters.')
  .max(63, 'Slug must be at most 63 characters.')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug may only contain lowercase letters, numbers, and hyphens.');

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required.').max(120),
  slug: slugSchema,
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: slugSchema.optional(),
  logo: z.string().url('Logo must be a valid URL.').nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  website: z.string().trim().url('Website must be a valid URL.').nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  size: z.string().trim().max(60).nullable().optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

/** Turns a display name into a URL-safe slug candidate, e.g. "Salgotra Industries" -> "salgotra-industries". */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}
