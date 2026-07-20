import { z } from 'zod';

import { paginationQuerySchema } from './query';

export const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const prioritySchema = z.enum(PRIORITIES);

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  status: projectStatusSchema.default('PLANNING'),
  priority: prioritySchema.default('MEDIUM'),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
  memberIds: z.array(z.string().min(1)).default([]),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const projectQuerySchema = paginationQuerySchema.extend({
  status: projectStatusSchema.optional(),
  priority: prioritySchema.optional(),
  ownerId: z.string().min(1).optional(),
  sortBy: z.enum(['title', 'status', 'priority', 'dueDate', 'createdAt']).default('createdAt'),
});
export type ProjectQuery = z.infer<typeof projectQuerySchema>;
