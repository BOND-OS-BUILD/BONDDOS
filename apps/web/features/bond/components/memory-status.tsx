'use client';

import { Badge } from '@bond-os/ui';

export interface MemoryStatusProps {
  /** Number of prior messages already in the conversation, as owned by the parent. */
  messageCount: number;
}

/** Trivial presentational badge — no data fetching of its own. */
export function MemoryStatus({ messageCount }: MemoryStatusProps) {
  const label =
    messageCount > 0 ? `Using last ${messageCount} message${messageCount === 1 ? '' : 's'}` : 'New conversation';
  return <Badge variant="secondary">{label}</Badge>;
}
