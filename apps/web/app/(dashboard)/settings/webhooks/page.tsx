import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import { EmptyState } from '@bond-os/ui';
import { Webhook } from 'lucide-react';

import { listWebhooksService } from '@/features/webhooks/services/webhook.service';
import { getActiveOrganization } from '@/lib/organization';

import { WebhooksManager } from './webhooks-manager';

/**
 * Phase 11 — outbound webhooks settings. ADMIN-only (webhooks are org-level
 * integration config). Non-admins see a notice rather than the manager.
 */
export const dynamic = 'force-dynamic';

export default async function WebhooksSettingsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  if (!roleSatisfies(active.role, ROLES.ADMIN)) {
    return (
      <EmptyState
        icon={Webhook}
        title="Admins only"
        description="Webhooks are managed by organization admins. Ask an admin to set up integrations."
      />
    );
  }

  const webhooks = await listWebhooksService();
  return <WebhooksManager initialWebhooks={webhooks} />;
}
