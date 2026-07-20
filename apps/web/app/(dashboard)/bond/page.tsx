import { Bot } from 'lucide-react';

import { EmptyState } from '@bond-os/ui';

import { NewConversationButton } from '@/features/bond/components/new-conversation-button';

/**
 * The "Mr. Bond" section home — shown at /bond before any conversation is
 * selected. Auth/active-org resolution already happened in bond/layout.tsx,
 * which wraps this page, so nothing further to fetch here.
 */
export default function BondPage() {
  return (
    <EmptyState
      icon={Bot}
      title="Meet Mr. Bond"
      description="Your AI copilot for this workspace. Ask about your projects, documents, customers, or anything else in BOND OS — Mr. Bond retrieves the relevant context and cites its sources."
      action={<NewConversationButton />}
      className="min-h-[60vh]"
    />
  );
}
