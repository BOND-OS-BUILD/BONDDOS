import { isPlatformAdmin, requireAuth } from '@bond-os/auth';

import { getActiveOrganization } from '@/lib/organization';

import { CreateOrganizationForm } from './create-organization-form';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  const { organizations, active } = await getActiveOrganization(session.user.id);

  if (!active) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <CreateOrganizationForm />
      </div>
    );
  }

  const user = {
    name: session.user.name,
    email: session.user.email,
    avatar: session.user.image ?? null,
  };

  const platformAdmin = await isPlatformAdmin();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar isPlatformAdmin={platformAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar organizations={organizations} active={active} user={user} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
