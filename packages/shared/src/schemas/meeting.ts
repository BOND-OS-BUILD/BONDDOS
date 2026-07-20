import { z } from 'zod';

import { paginationQuerySchema } from './query';

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(200),
  agenda: z.string().trim().max(4000).nullable().optional(),
  notes: z.string().trim().max(8000).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  meetingDate: z.coerce.date(),
  duration: z.coerce.number().int().min(0).max(24 * 60).nullable().optional(),
  projectId: z.string().min(1, 'A project is required.'),
  attendeeIds: z.array(z.string().min(1)).default([]),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = createMeetingSchema.partial();
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export const meetingQuerySchema = paginationQuerySchema.extend({
  projectId: z.string().min(1).optional(),
  sortBy: z.enum(['title', 'meetingDate', 'createdAt']).default('meetingDate'),
});
export type MeetingQuery = z.infer<typeof meetingQuerySchema>;
