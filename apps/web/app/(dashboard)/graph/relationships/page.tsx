import Link from 'next/link';

import { relationshipQuerySchema } from '@bond-os/shared';
import {
  Badge,
  EmptyState,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bond-os/ui';
import { Waypoints } from 'lucide-react';

import { RelationshipTypeFilter } from '@/features/graph/components/relationship-type-filter';
import { getNodeStyle, nodeHref } from '@/features/graph/lib/node-style';
import { listRelationshipsService } from '@/features/graph/services/graph.service';
import { requireActiveOrganizationId } from '@/lib/organization';

function EntityCell({ id, title, entityType }: { id: string; title: string; entityType: string }) {
  const { label, icon: Icon } = getNodeStyle(entityType);
  const href = nodeHref(entityType, id);

  const content = (
    <span className="inline-flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">({label})</span>
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="hover:underline">
      {content}
    </Link>
  );
}

export default async function RelationshipsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organizationId = await requireActiveOrganizationId();
  const params = await searchParams;
  const query = relationshipQuerySchema.parse(params);

  const result = await listRelationshipsService(organizationId, {
    page: query.page,
    pageSize: query.pageSize,
    relationshipType: query.relationshipType,
  });

  const makeHref = (page: number) => {
    const searchParamsOut = new URLSearchParams();
    if (query.relationshipType) searchParamsOut.set('relationshipType', query.relationshipType);
    searchParamsOut.set('page', String(page));
    return `/graph/relationships?${searchParamsOut.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Relationship Explorer</h1>
        <p className="text-sm text-muted-foreground">
          Every relationship extracted across your organization, deterministically, without AI.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <RelationshipTypeFilter value={query.relationshipType} />
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={Waypoints}
          title="No relationships yet"
          description="Relationships appear automatically once Library documents are processed, or add them manually via the API."
        />
      ) : (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Relationship</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <EntityCell
                      id={item.sourceEntity.id}
                      title={item.sourceEntity.title}
                      entityType={item.sourceEntity.entityType}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <Badge variant="secondary">{item.relationshipType}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {Math.round(item.confidence * 100)}%
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <EntityCell
                      id={item.targetEntity.id}
                      title={item.targetEntity.title}
                      entityType={item.targetEntity.entityType}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
