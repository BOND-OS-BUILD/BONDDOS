import Link from 'next/link';

import { requireAuth } from '@bond-os/auth';
import { spaceListQuerySchema } from '@bond-os/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Pagination } from '@bond-os/ui';
import { LayoutGrid, Plus, Users } from 'lucide-react';

import { SpaceFormDialog } from '@/features/spaces/components/space-form-dialog';
import { listSpacesService } from '@/features/spaces/services/space.service';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Team Spaces (Phase 9) — curation and grouping, not a parallel ACL. See docs/spaces.md. */
export default async function SpacesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const query = spaceListQuerySchema.parse(await searchParams);
  const result = await listSpacesService(organizationId, user.id, query.page, query.pageSize, query.mine);

  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.mine) params.set('mine', 'true');
    params.set('page', String(page));
    return `/spaces?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Spaces</h1>
          <p className="text-sm text-muted-foreground">
            Group projects, documents, workflows, and agents for a team. Spaces curate — they don&apos;t restrict
            who can see the underlying content.
          </p>
        </div>
        <SpaceFormDialog
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New space
            </Button>
          }
        />
      </div>

      <div className="flex gap-2">
        <Link
          href="/spaces"
          className={`rounded-full border px-3 py-1 text-sm ${!query.mine ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent'}`}
        >
          All spaces
        </Link>
        <Link
          href="/spaces?mine=true"
          className={`rounded-full border px-3 py-1 text-sm ${query.mine ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent'}`}
        >
          My spaces
        </Link>
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={query.mine ? "You haven't joined any spaces yet" : 'No spaces yet'}
          description="Create a space to group projects, documents, workflows, and agents for your team."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((space) => (
              <Link key={space.id} href={`/spaces/${space.id}`}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader>
                    <CardTitle className="text-base">{space.name}</CardTitle>
                    {space.description && <CardDescription className="line-clamp-2">{space.description}</CardDescription>}
                  </CardHeader>
                  <CardContent className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {space.memberCount} {space.memberCount === 1 ? 'member' : 'members'}
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
