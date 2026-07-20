import { requireAuth } from '@bond-os/auth';
import { prisma } from '@bond-os/database';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@bond-os/ui';

import { getActiveOrganization } from '@/lib/organization';

export default async function DashboardPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  // The layout guarantees an active organization exists by the time this
  // page renders (it shows the create-organization flow otherwise), but
  // guard defensively rather than asserting.
  if (!active) {
    return null;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { organizationId: active.id },
  });

  const firstName = session.user.name.split(' ')[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
        <p className="text-muted-foreground">Here&apos;s a quick look at your organization.</p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{active.name}</CardTitle>
          <CardDescription>/{active.slug}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Your role</span>
            <Badge variant="secondary">{active.role}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Workspace ID</span>
            <span className="font-mono text-xs">{workspace?.id ?? '—'}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
