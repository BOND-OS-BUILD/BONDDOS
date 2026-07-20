import { Card, CardContent, CardHeader, CardTitle, StatCard } from '@bond-os/ui';
import { GitBranch, Network, TrendingUp, Waypoints } from 'lucide-react';

import { GraphExplorer, type GraphSeed } from '@/features/graph/components/graph-explorer';
import { getGraphAnalyticsService } from '@/features/graph/services/graph.service';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function GraphPage() {
  const organizationId = await requireActiveOrganizationId();
  const analytics = await getGraphAnalyticsService(organizationId);

  const seedsById = new Map<string, GraphSeed>();
  for (const node of analytics.topConnectedNodes) {
    seedsById.set(node.id, { id: node.id, type: node.entityType, title: node.title });
  }
  for (const node of analytics.recentlyAdded) {
    if (!seedsById.has(node.id)) seedsById.set(node.id, { id: node.id, type: node.entityType, title: node.title });
  }
  const initialSeeds = Array.from(seedsById.values()).slice(0, 16);

  const growthLast7 = analytics.growthOverTime.slice(-7).reduce((sum, day) => sum + day.count, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Graph</h1>
        <p className="text-sm text-muted-foreground">
          Entities and relationships extracted automatically from your documents — no AI, deterministic rules only.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total entities" value={analytics.totalEntities} icon={Network} />
        <StatCard label="Total relationships" value={analytics.totalRelationships} icon={Waypoints} />
        <StatCard
          label="Relationship types in use"
          value={analytics.relationshipTypeBreakdown.length}
          icon={GitBranch}
        />
        <StatCard label="New entities (7d)" value={growthLast7} icon={TrendingUp} />
      </div>

      {analytics.relationshipTypeBreakdown.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Relationship types</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 text-sm">
              {analytics.relationshipTypeBreakdown.map((entry) => (
                <div key={entry.relationshipType} className="rounded-md border border-border px-2.5 py-1">
                  <span className="font-medium">{entry.relationshipType}</span>{' '}
                  <span className="text-muted-foreground">({entry.count})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <GraphExplorer initialSeeds={initialSeeds} />
    </div>
  );
}
