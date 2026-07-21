'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { ROUTES } from '@bond-os/shared';
import { Badge, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from '@bond-os/ui';
import { Bell } from 'lucide-react';

interface LiveNotification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

interface NotificationsSnapshot {
  unreadCount: number;
  latest: LiveNotification[];
}

/**
 * Live notification bell (Phase 9) — the one always-mounted subscriber to
 * the `notifications` SSE channel; Inbox/Activity/Team Dashboard are
 * otherwise server-rendered snapshots refreshed on navigation, same as
 * every other page in this codebase before Phase 9. See docs/collaboration.md.
 */
export function NotificationBell() {
  const [snapshot, setSnapshot] = useState<NotificationsSnapshot>({ unreadCount: 0, latest: [] });
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    let eventSource: EventSource | null = null;

    function connect() {
      if (stoppedRef.current) return;
      eventSource = new EventSource('/api/collaboration/stream?type=notifications');

      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as { type: string; data?: NotificationsSnapshot };
          if (parsed.type === 'snapshot' && parsed.data) {
            setSnapshot(parsed.data);
          } else if (parsed.type === 'reconnect') {
            eventSource?.close();
            connect();
          }
        } catch {
          // ignore malformed frames
        }
      };

      eventSource.onerror = () => {
        eventSource?.close();
        if (!stoppedRef.current) setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      stoppedRef.current = true;
      eventSource?.close();
    };
  }, []);

  return (
    <Dropdown>
      <DropdownTrigger className="relative rounded-full p-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
        <Bell className="h-5 w-5" />
        {snapshot.unreadCount > 0 && (
          <Badge variant="destructive" className="absolute -right-1 -top-1 h-4 min-w-4 justify-center px-1 text-[10px]">
            {snapshot.unreadCount > 99 ? '99+' : snapshot.unreadCount}
          </Badge>
        )}
      </DropdownTrigger>
      <DropdownContent align="end" className="w-80">
        <DropdownLabel>Notifications</DropdownLabel>
        <DropdownSeparator />
        {snapshot.latest.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          snapshot.latest.slice(0, 8).map((notification) => (
            <DropdownItem key={notification.id} asChild className="cursor-pointer">
              <Link href={ROUTES.inbox} className="flex flex-col items-start gap-0.5 whitespace-normal py-2">
                <span className={`text-sm ${notification.read ? 'text-muted-foreground' : 'font-medium'}`}>{notification.title}</span>
                <span className="line-clamp-1 text-xs text-muted-foreground">{notification.body}</span>
              </Link>
            </DropdownItem>
          ))
        )}
        <DropdownSeparator />
        <DropdownItem asChild className="cursor-pointer justify-center text-sm">
          <Link href={ROUTES.inbox}>View all</Link>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
