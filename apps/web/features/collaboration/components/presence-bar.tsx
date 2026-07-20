'use client';

import { useEffect, useRef, useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@bond-os/ui';

const HEARTBEAT_INTERVAL_MS = 15_000;

interface PresenceViewer {
  user: { id: string; name: string; avatar: string | null };
  status: 'online' | 'idle' | 'busy';
}

interface PresenceSnapshot {
  viewers: PresenceViewer[];
}

/**
 * Live presence for one entity page (Phase 9) — sends a heartbeat every
 * ~15s and subscribes to the `presence` channel on the shared SSE
 * primitive for the current viewer list. See docs/presence.md,
 * docs/collaboration.md.
 */
export function PresenceBar({ page, currentUserId }: { page: string; currentUserId: string }) {
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    function sendHeartbeat() {
      fetch('/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page, status: 'online' }),
      }).catch(() => undefined);
    }

    sendHeartbeat();
    const heartbeatId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    let eventSource: EventSource | null = null;

    function connect() {
      if (stoppedRef.current) return;
      eventSource = new EventSource(`/api/collaboration/stream?type=presence&page=${encodeURIComponent(page)}`);

      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as { type: string; data?: PresenceSnapshot };
          if (parsed.type === 'snapshot' && parsed.data) {
            setViewers(parsed.data.viewers);
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
      clearInterval(heartbeatId);
      eventSource?.close();
    };
  }, [page]);

  const others = viewers.filter((viewer) => viewer.user.id !== currentUserId);
  if (others.length === 0) return null;

  return (
    <div className="flex items-center -space-x-2" title={others.map((viewer) => viewer.user.name).join(', ')}>
      {others.slice(0, 5).map((viewer) => (
        <Avatar key={viewer.user.id} className="h-6 w-6 border-2 border-background">
          <AvatarImage src={viewer.user.avatar ?? undefined} />
          <AvatarFallback className="text-[10px]">{viewer.user.name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
      {others.length > 5 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium">
          +{others.length - 5}
        </span>
      )}
    </div>
  );
}
