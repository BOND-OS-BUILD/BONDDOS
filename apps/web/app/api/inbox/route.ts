import { requireAuth } from '@bond-os/auth';

import { getInboxSummaryService } from '@/features/notifications/services/notification.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * The Inbox's 6-category badge-count summary (Assigned/Mentions/Approvals/
 * AI Insights/Workflow Events/Activity). The paginated feed for one
 * category is `GET /api/notifications?category=<name>` — this route is
 * only the overview used to build the Inbox's sidebar/tabs. See
 * docs/notifications.md.
 */
export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const summary = await getInboxSummaryService(organizationId, user.id);
  return apiSuccess(summary);
});
