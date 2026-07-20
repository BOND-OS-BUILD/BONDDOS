'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Archive, Pin, PinOff, Trash2 } from 'lucide-react';

import type { ConversationListItem } from '@bond-os/database';
import { ROUTES } from '@bond-os/shared';
import { cn, ConfirmDialog, toast } from '@bond-os/ui';

export interface ConversationListProps {
  conversations: ConversationListItem[];
}

/** Compact "2h ago" / "3d ago" formatting — no date-fns dependency in this app. */
function formatRelativeTime(date: Date | string | null): string | null {
  if (!date) return null;
  const then = new Date(date).getTime();
  const diffMinutes = Math.round((Date.now() - then) / 60_000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.round(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  const diffMonths = Math.round(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.round(diffDays / 365)}y ago`;
}

/**
 * The persistent left-hand thread list for /bond (see bond/layout.tsx).
 * Receives its initial data as a server-fetched prop; every mutation below
 * hits the /api/bond/conversations REST surface and calls `router.refresh()`
 * so the server-rendered list (and any other consumer of it) stays in sync.
 */
export function ConversationList({ conversations }: ConversationListProps) {
  const pathname = usePathname();
  const router = useRouter();

  function navigateAwayIfActive(conversationId: string) {
    if (pathname === `${ROUTES.bond}/${conversationId}`) {
      router.push(ROUTES.bond);
    }
  }

  async function handlePinToggle(conversation: ConversationListItem) {
    const response = await fetch(`/api/bond/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !conversation.pinned }),
    });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    router.refresh();
  }

  async function handleArchive(conversation: ConversationListItem) {
    const response = await fetch(`/api/bond/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Conversation archived.');
    navigateAwayIfActive(conversation.id);
    router.refresh();
  }

  async function handleDelete(conversation: ConversationListItem) {
    const response = await fetch(`/api/bond/conversations/${conversation.id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Conversation deleted.');
    navigateAwayIfActive(conversation.id);
    router.refresh();
  }

  if (conversations.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No conversations yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-0.5 p-2">
      {conversations.map((conversation) => {
        const href = `${ROUTES.bond}/${conversation.id}`;
        const active = pathname === href;
        const relativeTime = formatRelativeTime(conversation.lastMessageAt);

        return (
          <li key={conversation.id} className="group relative">
            <Link
              href={href}
              className={cn(
                'flex flex-col gap-0.5 rounded-md px-3 py-2 pr-20 text-sm transition-colors',
                active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
              )}
            >
              <span className="flex items-center gap-1.5 truncate font-medium">
                {conversation.pinned ? (
                  <Pin className="h-3 w-3 shrink-0 fill-current text-muted-foreground" aria-label="Pinned" />
                ) : null}
                <span className="truncate">{conversation.title ?? 'Untitled conversation'}</span>
              </span>
              <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <span>{relativeTime ?? 'No messages yet'}</span>
                {conversation.messageCount > 0 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {conversation.messageCount} {conversation.messageCount === 1 ? 'message' : 'messages'}
                    </span>
                  </>
                ) : null}
              </span>
            </Link>

            <div className="absolute right-1 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                onClick={() => handlePinToggle(conversation)}
                aria-label={conversation.pinned ? 'Unpin conversation' : 'Pin conversation'}
                className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {conversation.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => handleArchive(conversation)}
                aria-label="Archive conversation"
                className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                }
                title="Delete this conversation?"
                description="This permanently deletes the conversation and its messages. This can't be undone."
                onConfirm={() => handleDelete(conversation)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
