import { z } from 'zod';

import { ROLES } from '../constants';

export const roleSchema = z.enum([ROLES.OWNER, ROLES.ADMIN, ROLES.MEMBER]);

export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  role: roleSchema.default(ROLES.MEMBER),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: roleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
