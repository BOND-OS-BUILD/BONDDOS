import { redirect } from 'next/navigation';

import { isPlatformAdmin } from '@bond-os/auth';
import { ROUTES } from '@bond-os/shared';

import { AdminNav } from './admin-nav';

/**
 * Phase 10 — Admin Console shell. This route group is OUTSIDE (dashboard), so
 * it has no active-organization requirement — a platform admin operates the
 * whole deployment. Access is gated here (redirect non-admins) and again in
 * every admin service via `requirePlatformAdmin()`.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isPlatformAdmin())) {
    redirect(ROUTES.dashboard);
  }
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-card p-3">
        <div className="mb-4 px-2">
          <p className="text-sm font-semibold">Admin Console</p>
          <p className="text-xs text-muted-foreground">Platform administration</p>
        </div>
        <AdminNav />
      </aside>
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
