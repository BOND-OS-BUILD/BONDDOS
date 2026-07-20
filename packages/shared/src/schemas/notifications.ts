import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Notifications & Inbox (Phase 9). See docs/notifications.md. */

export const NOTIFICATION_CATEGORIES = ['assigned', 'mentions', 'approvals', 'ai_insights', 'workflow_events', 'activity'] as const;
export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;

export const notificationListQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  read: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  category: notificationCategorySchema.optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const snoozeNotificationSchema = z.object({
  snoozedUntil: z.coerce.date(),
});
export type SnoozeNotificationInput = z.infer<typeof snoozeNotificationSchema>;
