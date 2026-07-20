import { z } from 'zod';

import { paginationQuerySchema } from './query';

/**
 * Organization Activity Feed (Phase 9) — a read view over the existing
 * `Event` table (docs/event-bus.md), not a new table. Filterable by
 * event type, entity, and date range — all backed by real indexed columns.
 * NOT filterable by user/actor: `Event` has no `userId`/actor column today,
 * so that spec-listed filter isn't supported. See docs/activity-feed.md.
 */
export const activityFeedQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  eventType: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});
export type ActivityFeedQuery = z.infer<typeof activityFeedQuerySchema>;
