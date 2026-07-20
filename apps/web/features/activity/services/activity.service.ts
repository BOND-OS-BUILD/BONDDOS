import { requireRole } from '@bond-os/auth';
import { listEvents, type EventData } from '@bond-os/database';
import { ROLES, type ActivityFeedQuery, type PaginatedResult } from '@bond-os/shared';

/** Organization Activity Feed (Phase 9) — a plain read over `listEvents`. See docs/activity-feed.md. */
export async function listActivityFeedService(organizationId: string, query: ActivityFeedQuery): Promise<PaginatedResult<EventData>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listEvents({ organizationId, ...query });
}
