import { z } from 'zod';

import { prioritySchema } from './project';
import { paginationQuerySchema } from './query';

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  status: taskStatusSchema.default('TODO'),
  priority: prioritySchema.default('MEDIUM'),
  dueDate: z.coerce.date().nullable().optional(),
  projectId: z.string().min(1, 'A project is required.'),
  assigneeId: z.string().min(1).nullable().optional(),
  documentIds: z.array(z.string().min(1)).default([]),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema.partial();
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskQuerySchema = paginationQuerySchema.extend({
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  projectId: z.string().min(1).optional(),
  assigneeId: z.string().min(1).optional(),
  sortBy: z.enum(['title', 'status', 'priority', 'dueDate', 'createdAt']).default('createdAt'),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;
