import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bond-os/ui';
import { Sparkles } from 'lucide-react';

import { getAIHealthService, listAIModelsService } from '@/features/ai/services/ai.service';
import { getActiveOrganization } from '@/lib/organization';

export default async function AiModelsPage() {
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
          <CardTitle>Models</CardTitle>
          <CardDescription>Admins and owners can view AI configuration.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [health, models] = await Promise.all([
    getAIHealthService(active.id),
    listAIModelsService(active.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
        <p className="text-sm text-muted-foreground">Provider health and the models available for generation.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={health.healthy ? 'success' : 'destructive'}>
              {health.healthy ? 'Healthy' : 'Unhealthy'}
            </Badge>
            {health.latencyMs !== undefined ? (
              <span className="text-sm text-muted-foreground">Responded in {health.latencyMs}ms</span>
            ) : null}
          </div>
          {health.message ? <p className="text-sm text-muted-foreground">{health.message}</p> : null}
        </CardContent>
      </Card>

      {!health.configured ? (
        <EmptyState
          icon={Sparkles}
          title="No AI provider configured"
          description="Set AI_PROVIDER and the matching API key to see available models."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Available models</CardTitle>
          </CardHeader>
          <CardContent>
            {models.length === 0 ? (
              <p className="text-sm text-muted-foreground">No models returned.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((model) => (
                    <TableRow key={model.id}>
                      <TableCell className="font-mono text-sm">{model.id}</TableCell>
                      <TableCell>{model.name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
