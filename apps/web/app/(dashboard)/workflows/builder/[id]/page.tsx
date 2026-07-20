import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import { Badge, type BadgeProps, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@bond-os/ui';
import { Lock } from 'lucide-react';

import { WorkflowBuilderCanvas } from '@/features/workflows/components/workflow-builder-canvas';
import { getWorkflowDefinitionService } from '@/features/workflows/lib/container';
import type { WorkflowGraphDefinition } from '@/features/workflows/lib/workflow-graph';
import { getActiveOrganization } from '@/lib/organization';

/**
 * Phase 8 Workflow Builder wrapper — same auth/org/role gate as
 * `workflows/page.tsx`, then fetches the single `WorkflowDefinition` via
 * `getWorkflowDefinitionService().get()` (server component calling the
 * service directly, per `agents/goals/[id]/page.tsx`'s convention) and
 * renders metadata plus the client `WorkflowBuilderCanvas`. A published
 * (non-DRAFT) definition is immutable by design — see
 * `WorkflowDefinitionService.publish` — so the canvas below is read-only in
 * that case; nothing on this page can un-publish or edit it.
 */

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  DRAFT: 'secondary',
  ACTIVE: 'success',
  DISABLED: 'outline',
};

export default async function WorkflowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const canView = roleSatisfies(active.role, ROLES.MEMBER);

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Workflow Builder</CardTitle>
          <CardDescription>Organization members can view and edit workflows.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const definition = await getWorkflowDefinitionService().get(id, active.id);
  const graph = definition.graph as unknown as WorkflowGraphDefinition;
  const isDraft = definition.status === 'DRAFT';

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{definition.name}</h1>
          <Badge variant={STATUS_VARIANT[definition.status] ?? 'outline'}>{definition.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{definition.description || 'No description.'}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Workflow key</p>
            <p className="mt-0.5">{definition.workflowKey}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Version</p>
            <p className="mt-0.5">{definition.version}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Trigger type</p>
            <p className="mt-0.5">{definition.triggerType}</p>
          </div>
        </CardContent>
      </Card>

      {!isDraft ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This workflow is published and read-only; only DRAFT workflows can be edited. Publishing freezes a
            definition&apos;s graph, trigger, and conditions into an immutable, versioned record so an in-flight run
            always resumes against the exact graph it started with.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Graph</CardTitle>
          <CardDescription>
            {isDraft
              ? 'Click a node to view or edit its configuration.'
              : 'Click a node to view its configuration (read-only).'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkflowBuilderCanvas
            workflowId={definition.id}
            status={definition.status}
            triggerType={definition.triggerType}
            trigger={definition.trigger}
            steps={graph.steps}
          />
        </CardContent>
      </Card>
    </div>
  );
}
