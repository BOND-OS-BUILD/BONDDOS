import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@bond-os/ui';

import { DelegationGraph } from '@/features/agents/components/delegation-graph';
import { getActiveOrganization } from '@/lib/organization';

export default async function AgentDelegationPage() {
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
          <CardTitle>Delegation Graph</CardTitle>
          <CardDescription>Organization members can view agent delegation activity.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Delegation Graph</h1>
        <p className="text-sm text-muted-foreground">
          Which agents have delegated or handed off work to which others, sourced from the Agent Timeline
          (eventType=DELEGATION).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent delegations</CardTitle>
        </CardHeader>
        <CardContent>
          <DelegationGraph />
        </CardContent>
      </Card>
    </div>
  );
}
