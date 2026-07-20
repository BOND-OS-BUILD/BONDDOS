import { getCache } from '@bond-os/shared/server';

/**
 * The generic realtime transport (Phase 9) — a reconnecting SSE poll loop,
 * not WebSockets. No persistent-process guarantee exists in this codebase
 * (see docs/collaboration.md), so a connection is held open for a bounded
 * window, then the stream emits `reconnect` and closes; the CLIENT is what
 * reopens it, giving a continuously-live feel without ever assuming a
 * long-running server process. This one primitive backs Presence,
 * Notifications, the Activity Feed, Live Dashboards, and live comment-thread
 * updates — each just supplies its own `fetchSnapshot`.
 *
 * Per-channel snapshot caching goes through the existing `Cache` abstraction
 * (`getCache()` — `InMemoryCache` by default, `RedisCache` when `REDIS_URL`
 * is set) rather than a new table or in-process map: N simultaneous viewers
 * of the same channel collapse to ~1 underlying query per TTL window. See
 * docs/collaboration.md.
 */

const POLL_INTERVAL_MS = 2500;
const SNAPSHOT_CACHE_TTL_SECONDS = 2;
/** Safety margin under the route's `maxDuration = 30` — leaves headroom for the final `reconnect` event and response teardown to actually flush before the platform kills the function. */
const STREAM_DURATION_MS = 25_000;

export type ChannelStreamEvent<T> = { type: 'snapshot'; data: T } | { type: 'reconnect' };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dedupedSnapshot<T>(channelKey: string, fetchSnapshot: () => Promise<T>): Promise<T> {
  const cache = getCache();
  const cacheKey = `collab:snapshot:${channelKey}`;
  const cached = await cache.get<T>(cacheKey);
  if (cached !== null) return cached;

  const fresh = await fetchSnapshot();
  await cache.set(cacheKey, fresh, SNAPSHOT_CACHE_TTL_SECONDS);
  return fresh;
}

/**
 * Emits an initial snapshot, then polls (Cache-deduped) every ~2.5s and
 * emits a new snapshot only when the serialized content actually changed —
 * an idle channel with no changes produces no traffic beyond the poll
 * itself. After `STREAM_DURATION_MS`, emits `reconnect` and returns; the
 * route's caller is expected to have already primed this generator via one
 * `.next()` call before wrapping it in `createSseStream`, matching every
 * other SSE route in this codebase.
 */
export async function* channelStream<T>(channelKey: string, fetchSnapshot: () => Promise<T>): AsyncGenerator<ChannelStreamEvent<T>> {
  const startedAt = Date.now();
  let lastSerialized: string | null = null;

  const emitIfChanged = async (): Promise<ChannelStreamEvent<T> | null> => {
    const data = await dedupedSnapshot(channelKey, fetchSnapshot);
    const serialized = JSON.stringify(data);
    if (serialized === lastSerialized) return null;
    lastSerialized = serialized;
    return { type: 'snapshot', data };
  };

  const first = await emitIfChanged();
  if (first) yield first;

  while (Date.now() - startedAt < STREAM_DURATION_MS) {
    await sleep(POLL_INTERVAL_MS);
    const next = await emitIfChanged();
    if (next) yield next;
  }

  yield { type: 'reconnect' };
}
