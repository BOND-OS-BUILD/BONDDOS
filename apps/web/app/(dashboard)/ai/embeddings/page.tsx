import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@bond-os/ui';
import { Clock, Database, Layers } from 'lucide-react';

import { EmbeddingAdminActions } from '@/features/embeddings/components/embedding-admin-actions';
import { getEmbeddingJobStatsService, getEmbeddingStatsService } from '@/features/embeddings/services/embedding-stats.service';
import { getModelManagementInfoService } from '@/features/ai/services/ai.service';
import { getActiveOrganization } from '@/lib/organization';

export default async function AiEmbeddingsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const canView = roleSatisfies(active.role, ROLES.ADMIN);

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Embeddings</CardTitle>
          <CardDescription>Admins and owners can view AI configuration.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [embeddingStats, jobStats, modelInfo] = await Promise.all([
    getEmbeddingStatsService(active.id),
    getEmbeddingJobStatsService(active.id),
    getModelManagementInfoService(active.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Embeddings</h1>
        <p className="text-sm text-muted-foreground">
          Vector embedding coverage and background job status for retrieval.
        </p>
      </div>

      <EmbeddingAdminActions />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total embeddings" value={embeddingStats.total} icon={Database} />
        <StatCard
          label="Embedding provider / model"
          value={`${modelInfo.embeddingProvider} / ${modelInfo.embeddingModel}`}
          icon={Layers}
        />
        <StatCard
          label="Last embedded"
          value={embeddingStats.lastEmbeddedAt ? new Date(embeddingStats.lastEmbeddedAt).toLocaleString() : 'Never'}
          icon={Clock}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By source type</CardTitle>
        </CardHeader>
        <CardContent>
          {embeddingStats.bySourceType.length > 0 ? (
            <div className="flex flex-wrap gap-3 text-sm">
              {embeddingStats.bySourceType.map((entry) => (
                <div key={entry.sourceType} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
                  <Badge variant="outline">{entry.sourceType}</Badge>
                  <span className="text-muted-foreground">{entry.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No embeddings yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Job status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 text-sm">
            <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
              <Badge variant="secondary">Pending</Badge>
              <span className="text-muted-foreground">{jobStats.pending}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
              <Badge variant="secondary">Running</Badge>
              <span className="text-muted-foreground">{jobStats.running}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
              <Badge variant="success">Succeeded</Badge>
              <span className="text-muted-foreground">{jobStats.succeeded}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
              <Badge variant="destructive">Failed</Badge>
              <span className="text-muted-foreground">{jobStats.failed}</span>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
              <Badge variant="secondary">Retrying</Badge>
              <span className="text-muted-foreground">{jobStats.retrying}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
