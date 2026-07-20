import Link from 'next/link';

import { requireAuth } from '@bond-os/auth';
import { ROUTES } from '@bond-os/shared';
import { Card, CardContent, CardHeader, CardTitle, StatCard } from '@bond-os/ui';
import { Bell, ShieldCheck, Workflow } from 'lucide-react';

import { getDashboardSnapshot } from '@/features/collaboration/services/dashboard.service';
import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Live Dashboards (Phase 9) — a snapshot of pending approvals, active
 * workflow runs, and unread notifications, refreshed by subscribing to the
 * `dashboard` channel client-side. See docs/collaboration.md.
 */
export default async function TeamDashboardPage() {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const snapshot = await getDashboardSnapshot(organizationId, user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          What needs attention right now — pending approvals, running workflows, and your unread notifications.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href={ROUTES.workflowApprovals}>
          <StatCard label="Pending approvals" value={snapshot.pendingApprovals} icon={ShieldCheck} />
        </Link>
        <Link href={ROUTES.workflowRuns}>
          <StatCard label="Active workflow runs" value={snapshot.activeWorkflowRuns} icon={Workflow} />
        </Link>
        <Link href={ROUTES.inbox}>
          <StatCard label="Unread notifications" value={snapshot.unreadNotifications} icon={Bell} />
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About this dashboard</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This is a snapshot as of your last page load. It reuses the same underlying queries as the
          Approvals, Workflow Runs, and Inbox pages — nothing here is computed or stored separately.
        </CardContent>
      </Card>
    </div>
  );
}
