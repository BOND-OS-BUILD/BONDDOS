import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies, type NotificationCategory } from '@bond-os/shared';
import { Badge, Card, CardContent, EmptyState, Pagination } from '@bond-os/ui';
import { Inbox as InboxIcon } from 'lucide-react';

import { MarkAllReadButton } from '@/features/notifications/components/mark-all-read-button';
import { NotificationActions } from '@/features/notifications/components/notification-actions';
import { getInboxSummaryService, listNotificationsService } from '@/features/notifications/services/notification.service';
import { getActiveOrganization } from '@/lib/organization';

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  assigned: 'Assigned',
  mentions: 'Mentions',
  approvals: 'Approvals',
  ai_insights: 'AI Insights',
  workflow_events: 'Workflow Events',
  activity: 'Activity',
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as NotificationCategory[];

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  if (!roleSatisfies(active.role, ROLES.MEMBER)) {
    return (
      <EmptyState icon={InboxIcon} title="Inbox" description="Organization members can view their inbox." />
    );
  }

  const params = await searchParams;
  const rawCategory = typeof params.category === 'string' ? params.category : undefined;
  const category = CATEGORIES.includes(rawCategory as NotificationCategory) ? (rawCategory as NotificationCategory) : undefined;
  const page = Number(params.page) > 0 ? Number(params.page) : 1;
  const pageSize = 20;

  const [summary, result] = await Promise.all([
    getInboxSummaryService(active.id, session.user.id),
    listNotificationsService(active.id, session.user.id, { page, pageSize, category, archived: false }),
  ]);

  const makeHref = (nextCategory: NotificationCategory | undefined, nextPage: number) => {
    const qs = new URLSearchParams();
    if (nextCategory) qs.set('category', nextCategory);
    if (nextPage > 1) qs.set('page', String(nextPage));
    const query = qs.toString();
    return query ? `${ROUTES.inbox}?${query}` : ROUTES.inbox;
  };

  const totalUnread = Object.values(summary).reduce((sum, count) => sum + count, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Mentions, assignments, approvals, and other activity that needs your attention.
          </p>
        </div>
        <MarkAllReadButton />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={makeHref(undefined, 1)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
            !category ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent'
          }`}
        >
          All
          {totalUnread > 0 && (
            <Badge variant={!category ? 'secondary' : 'outline'} className="px-1.5 py-0 text-[10px]">
              {totalUnread}
            </Badge>
          )}
        </Link>
        {CATEGORIES.map((cat) => (
          <Link
            key={cat}
            href={makeHref(cat, 1)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
              category === cat ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent'
            }`}
          >
            {CATEGORY_LABELS[cat]}
            {summary[cat] > 0 && (
              <Badge variant={category === cat ? 'secondary' : 'outline'} className="px-1.5 py-0 text-[10px]">
                {summary[cat]}
              </Badge>
            )}
          </Link>
        ))}
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="Nothing here"
          description="You're all caught up — new mentions, assignments, and approvals will show up here."
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            {result.items.map((notification) => (
              <Card key={notification.id} className={notification.read ? 'opacity-70' : undefined}>
                <CardContent className="flex items-start justify-between gap-4 py-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      {!notification.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                      <span className="font-medium">{notification.title}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {notification.type.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{notification.body}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(notification.createdAt)}</p>
                  </div>
                  <NotificationActions id={notification.id} read={notification.read} />
                </CardContent>
              </Card>
            ))}
          </div>
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={(p) => makeHref(category, p)} />
        </div>
      )}
    </div>
  );
}
