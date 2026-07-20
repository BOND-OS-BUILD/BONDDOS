import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import {
  Badge,
  type BadgeProps,
  Button,
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
import { LayoutTemplate, Workflow } from 'lucide-react';

import { WorkflowTemplatesSection } from '@/features/workflows/components/workflow-templates-section';
import { getWorkflowDefinitionService } from '@/features/workflows/lib/container';
import { getActiveOrganization } from '@/lib/organization';

/**
 * Phase 8 "Workflow Automation Platform" — the Workflows list. Same
 * list-page-with-table convention as `execution/page.tsx`/`agents/goals/page.tsx`:
 * `requireAuth` + `getActiveOrganization` + redirect-if-no-active-org, then a
 * role gate before the data fetch (`WorkflowDefinitionService.list` itself
 * also enforces `requireRole`, so this gate is purely a friendlier fallback
 * than a thrown `ForbiddenError`). Calls `getWorkflowDefinitionService()`
 * directly, the same way `agents/goals/page.tsx` calls `getGoalService()`.
 */

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  DRAFT: 'secondary',
  ACTIVE: 'success',
  DISABLED: 'outline',
};

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatTriggerType(triggerType: string): string {
  return triggerType
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

export default async function WorkflowsPage() {
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
          <CardTitle>Workflows</CardTitle>
          <CardDescription>Organization members can view workflows.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const result = await getWorkflowDefinitionService().list({ organizationId: active.id, page: 1, pageSize: PAGE_SIZE });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Automations built in the visual workflow builder — a trigger that fans out into agent, tool, and
            control-flow steps. Drafts can be edited freely; publishing freezes a workflow into an immutable,
            versioned definition.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="#templates">
            <LayoutTemplate className="mr-2 h-4 w-4" />
            Browse Templates
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Definitions</CardTitle>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title="No workflows yet"
              description="Start from a template below — instantiating one creates an editable draft you can customize in the builder."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="#templates">New Workflow</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger Type</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>
                    <span className="sr-only">Detail</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((definition) => (
                  <TableRow key={definition.id}>
                    <TableCell className="font-medium">{definition.name}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[definition.status] ?? 'outline'}>{definition.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatTriggerType(definition.triggerType)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(definition.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`${ROUTES.workflowBuilder}/${definition.id}`}
                        className="text-sm font-medium underline underline-offset-4"
                      >
                        {definition.status === 'DRAFT' ? 'Edit' : 'View'}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div id="templates">
        <WorkflowTemplatesSection />
      </div>
    </div>
  );
}
