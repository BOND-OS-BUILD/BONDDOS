import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROUTES } from '@bond-os/shared';

import { ConversationList } from '@/features/bond/components/conversation-list';
import { NewConversationButton } from '@/features/bond/components/new-conversation-button';
import { listConversationsService } from '@/features/bond/services/conversation.service';
import { getActiveOrganization } from '@/lib/organization';

/**
 * Two-column shell for the "Mr. Bond" section: a persistent thread list on
 * the left (server-fetched here, same pattern as ai/page.tsx's
 * requireAuth()+getActiveOrganization()) and the active page (the /bond
 * welcome state or a /bond/[conversationId] thread) on the right.
 */
export default async function BondLayout({ children }: { children: ReactNode }) {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const conversations = await listConversationsService(active.id, session.user.id, {
    page: 1,
    pageSize: 100,
    sortDir: 'desc',
    archived: false,
  });

  return (
    <div className="flex gap-6">
      <aside className="sticky top-6 flex h-[calc(100vh-3rem)] w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Conversations</h2>
          <NewConversationButton variant="ghost" size="sm" label="New" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <ConversationList conversations={conversations.items} />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
