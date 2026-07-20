import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { getOrganizationById } from '@bond-os/database';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import { Avatar, AvatarFallback, AvatarImage, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@bond-os/ui';

import { getActiveOrganization } from '@/lib/organization';

import { OrganizationForm } from './organization-form';

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export default async function OrganizationSettingsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const canEdit = roleSatisfies(active.role, ROLES.ADMIN);

  const organization = await getOrganizationById(active.id);
  if (!organization) {
    redirect(ROUTES.dashboard);
  }

  if (!canEdit) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>Organization details are managed by an admin or owner.</CardDescription>
        </CardHeader>
        <CardContent className="max-w-sm space-y-6">
          <Avatar className="h-16 w-16 rounded-md">
            {active.logo ? <AvatarImage src={active.logo} alt="" /> : null}
            <AvatarFallback className="rounded-md text-lg">{active.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="space-y-4">
            <ReadOnlyField label="Organization name" value={active.name} />
            <ReadOnlyField label="URL slug" value={active.slug} />
          </div>
        </CardContent>
      </Card>
    );
  }

  return <OrganizationForm organization={organization} />;
}
