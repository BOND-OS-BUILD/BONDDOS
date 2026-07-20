import { listEvents, type EventSource } from '@bond-os/database';
import { workflowEventListQuerySchema } from '@bond-os/shared';

import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Event Monitor — a pure read over the Event Bus's append-only `Event` log
 * (Phase 8). `listEvents` is a plain repository function (already org-scoped
 * via its own `WHERE` clause) with no business logic and no `requireRole`
 * of its own, so this route calls `requireActiveOrganizationId()` itself
 * rather than adding a new one-line service wrapper. See docs/event-bus.md.
 */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, workflowEventListQuerySchema);
  const result = await listEvents({ organizationId, ...query, source: query.source as EventSource | undefined });
  return apiSuccess(result);
});
