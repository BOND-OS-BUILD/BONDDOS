import { redirect } from 'next/navigation';
import Link from 'next/link';

import { requireAuth } from '@bond-os/auth';
import { getOrganizationById, getOrganizationStats } from '@bond-os/database';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@bond-os/ui';
import { Contact, FileText, FolderKanban, Globe, ListTodo, Users, Video } from 'lucide-react';

import { getActiveOrganization } from '@/lib/organization';

export default async function CompanyPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const [organization, stats] = await Promise.all([
    getOrganizationById(active.id),
    getOrganizationStats(active.id),
  ]);

  if (!organization) {
    redirect(ROUTES.dashboard);
  }

  const canEdit = roleSatisfies(active.role, ROLES.ADMIN);

  const statTiles = [
    { label: 'Projects', value: stats.projects, href: ROUTES.projects, icon: FolderKanban },
    { label: 'Tasks', value: stats.tasks, href: ROUTES.tasks, icon: ListTodo },
    { label: 'Documents', value: stats.documents, href: ROUTES.documents, icon: FileText },
    { label: 'Meetings', value: stats.meetings, href: ROUTES.meetings, icon: Video },
    { label: 'Customers', value: stats.customers, href: ROUTES.customers, icon: Contact },
    { label: 'Members', value: stats.members, href: ROUTES.settingsMembers, icon: Users },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 rounded-md">
            {organization.logo ? <AvatarImage src={organization.logo} alt="" /> : null}
            <AvatarFallback className="rounded-md text-lg">
              {organization.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {organization.industry ? <Badge variant="outline">{organization.industry}</Badge> : null}
              {organization.size ? <span>{organization.size}</span> : null}
              {organization.website ? (
                <a
                  href={organization.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {organization.website.replace(/^https?:\/\//, '')}
                </a>
              ) : null}
            </div>
          </div>
        </div>
        {canEdit ? (
          <Button variant="outline" asChild>
            <Link href={ROUTES.settingsOrganization}>Edit company profile</Link>
          </Button>
        ) : null}
      </div>

      {organization.description ? (
        <p className="max-w-2xl text-sm text-muted-foreground">{organization.description}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {statTiles.map((tile) => (
          <Link key={tile.label} href={tile.href}>
            <Card className="transition-colors hover:bg-accent/50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <tile.icon className="h-4 w-4" />
                  {tile.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold">{tile.value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
