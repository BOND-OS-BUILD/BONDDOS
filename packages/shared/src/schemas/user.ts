import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120).optional(),
  avatar: z.string().url('Avatar must be a valid URL.').nullable().optional(),
  firstName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  timezone: z.string().trim().max(80).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
