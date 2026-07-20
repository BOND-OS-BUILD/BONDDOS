import { toUserSummary, type UserSummary } from '@bond-os/database';
import type { PresenceStatus } from '@bond-os/shared';
import { getCache } from '@bond-os/shared/server';

/**
 * Presence (Phase 9) — lives entirely in `Cache`, never Postgres. Presence
 * is ephemeral, high-frequency-write, and has zero audit value, which is an
 * intentional mismatch with a durable table. There is no explicit "user
 * went offline" write: absence of a fresh heartbeat past `PRESENCE_STALE_MS`
 * is what makes a user read as offline. See docs/presence.md.
 */

const PRESENCE_STALE_MS = 30_000; // ~2 missed heartbeats at the client's ~15s interval
const PRESENCE_KEY_TTL_SECONDS = 120; // generous whole-key eviction floor for a fully abandoned page; per-entry staleness (above) is what actually drives "online" vs "offline"

export interface PresenceEntry {
  user: UserSummary;
  status: PresenceStatus;
  entityId: string | null;
  cursor: { x: number; y: number } | null;
  lastActiveAt: number;
}

type PresenceMap = Record<string, PresenceEntry>;

function presenceCacheKey(organizationId: string, page: string): string {
  return `presence:org:${organizationId}:page:${page}`;
}

export interface RecordPresenceHeartbeatInput {
  organizationId: string;
  page: string;
  status: PresenceStatus;
  entityId?: string | null;
  cursor?: { x: number; y: number } | null;
  user: { id: string; name: string; email: string; image: string | null };
}

/**
 * Read-modify-write against ONE Cache key per (org, page) — not one key per
 * user, since `Cache` only supports get/set by exact key, with no
 * prefix-scan primitive a per-user-key design would need to assemble a
 * snapshot. Two users heartbeating the same page concurrently can race and
 * drop each other's write (`RedisCache` has no transaction wrapping this
 * read-modify-write). Deliberately accepted rather than fixed with a lock:
 * presence is ephemeral and self-healing — the next ~15s heartbeat repairs
 * any lost update — a materially different risk profile than the atomic
 * `updateMany` claims this codebase uses for actual state transitions
 * (approvals, workflow runs).
 */
export async function recordPresenceHeartbeat(input: RecordPresenceHeartbeatInput): Promise<void> {
  const cache = getCache();
  const key = presenceCacheKey(input.organizationId, input.page);
  const existing = (await cache.get<PresenceMap>(key)) ?? {};
  const now = Date.now();

  const next: PresenceMap = {};
  for (const [userId, entry] of Object.entries(existing)) {
    if (now - entry.lastActiveAt < PRESENCE_STALE_MS) next[userId] = entry;
  }

  next[input.user.id] = {
    user: toUserSummary(input.user),
    status: input.status,
    entityId: input.entityId ?? null,
    cursor: input.cursor ?? null,
    lastActiveAt: now,
  };

  await cache.set(key, next, PRESENCE_KEY_TTL_SECONDS);
}

export interface PresenceSnapshot {
  page: string;
  viewers: PresenceEntry[];
}

export async function getPresenceSnapshot(organizationId: string, page: string): Promise<PresenceSnapshot> {
  const cache = getCache();
  const key = presenceCacheKey(organizationId, page);
  const existing = (await cache.get<PresenceMap>(key)) ?? {};
  const now = Date.now();

  const viewers = Object.values(existing).filter((entry) => now - entry.lastActiveAt < PRESENCE_STALE_MS);
  return { page, viewers };
}
