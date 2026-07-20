import Link from 'next/link';

import { requireAuth } from '@bond-os/auth';
import { paginationQuerySchema, ROUTES } from '@bond-os/shared';
import { Badge, Card, CardContent, EmptyState, Pagination } from '@bond-os/ui';
import { Users } from 'lucide-react';

import { listConversationsSharedWithMeService } from '@/features/bond/services/conversation.service';
import { requireActiveOrganizationId } from '@/lib/organization';

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Shared AI Sessions (Phase 9) — conversations other org members have shared with you. See docs/shared-ai.md. */
export default async function SharedConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const query = paginationQuerySchema.pick({ page: true, pageSize: true }).parse(await searchParams);
  const result = await listConversationsSharedWithMeService(organizationId, user.id, query.page, query.pageSize);

  const makeHref = (page: number) => `${ROUTES.sharedConversations}?page=${page}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shared with me</h1>
        <p className="text-sm text-muted-foreground">Bond conversations other members of your organization have shared with you.</p>
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nothing shared yet"
          description="When someone shares a Bond conversation with you, it will show up here."
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            {result.items.map(({ share, conversation }) => (
              <Link key={share.id} href={`${ROUTES.bond}/${conversation.id}`}>
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate font-medium">{conversation.title ?? 'Untitled conversation'}</p>
                      <p className="text-xs text-muted-foreground">
                        Shared by {share.sharedBy?.name ?? 'a member'} · {formatDateTime(share.createdAt)}
                      </p>
                    </div>
                    <Badge variant={share.permission === 'COLLABORATE' ? 'default' : 'outline'}>
                      {share.permission === 'COLLABORATE' ? 'Can collaborate' : 'Read only'}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
