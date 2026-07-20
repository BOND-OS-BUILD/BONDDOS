import { listWorkflowRuns } from '@bond-os/database';

import { getUnreadNotificationCountService } from '@/features/notifications/services/notification.service';
import { listExecutionsService } from '@/features/execution/services/execution-history.service';

/**
 * Live Dashboards (Phase 9) — reuses the §1 realtime channel primitive with
 * a lightweight snapshot built entirely from existing Phase 6/7/8 queries;
 * no new aggregation infrastructure. Represents a subset of the spec's
 * "agent activity/workflow status/project health/pending approvals/
 * notifications/active users" list — pending approvals, active workflow
 * runs, and unread notifications, the three cheapest to compute from
 * already-indexed columns. See docs/collaboration.md.
 */

const ACTIVE_WORKFLOW_RUN_STATUSES = ['PENDING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_TIMER'] as const;

export interface DashboardSnapshot {
  pendingApprovals: number;
  activeWorkflowRuns: number;
  unreadNotifications: number;
}

export async function getDashboardSnapshot(organizationId: string, userId: string): Promise<DashboardSnapshot> {
  const [pendingApprovals, activeWorkflowRunCounts, unreadNotifications] = await Promise.all([
    listExecutionsService(organizationId, { page: 1, pageSize: 1, status: 'AWAITING_APPROVAL' }).then((result) => result.total),
    Promise.all(
      ACTIVE_WORKFLOW_RUN_STATUSES.map((status) =>
        listWorkflowRuns({ organizationId, page: 1, pageSize: 1, status }).then((result) => result.total),
      ),
    ),
    getUnreadNotificationCountService(organizationId, userId),
  ]);

  return {
    pendingApprovals,
    activeWorkflowRuns: activeWorkflowRunCounts.reduce((sum, count) => sum + count, 0),
    unreadNotifications,
  };
}
