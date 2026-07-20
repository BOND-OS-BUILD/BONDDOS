import Link from 'next/link';

import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, StatCard } from '@bond-os/ui';
import { Brain, Contact, Database, FolderKanban, Network, Waypoints } from 'lucide-react';

import { getOrganizationMemoryService } from '@/features/retrieval/services/memory.service';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function MemoryPage() {
  const organizationId = await requireActiveOrganizationId();
  const memory = await getOrganizationMemoryService(organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="text-sm text-muted-foreground">
          Everything BOND OS currently knows about your organization.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total entities" value={memory.totalEntities} icon={Network} />
        <StatCard label="Total relationships" value={memory.totalRelationships} icon={Waypoints} />
        <StatCard label="Total embeddings" value={memory.totalEmbeddings} icon={Database} />
        <StatCard label="Total projects" value={memory.totalProjects} icon={FolderKanban} />
      </div>

      {memory.recentlyAdded.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="Nothing here yet"
          description="Upload a document in the Library to get started."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recently added</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {memory.recentlyAdded.map((item) => (
                <Link
                  key={item.id}
                  href={`/graph/entity/${item.id}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.title}</span>
                    <Badge variant="outline">{item.entityType}</Badge>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Contact className="h-3.5 w-3.5" />
        {memory.totalCustomers} customer{memory.totalCustomers === 1 ? '' : 's'} tracked.
      </p>
    </div>
  );
}
