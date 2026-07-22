import { prisma } from '@bond-os/database';
import { getCache, getEnv, getQueue, logger } from '@bond-os/shared/server';

import { getAIProvider, isAIProviderConfigured } from '@/features/ai/services/ai-provider.service';
import { checkStorageHealth } from '@/lib/supabase';

const log = logger.child('health');

/** Version reported by the health endpoints (Phase 10 → v1.1.0). */
export const APP_VERSION = '1.1.0';

export type ComponentStatus = 'ok' | 'degraded' | 'down' | 'not_configured';

export interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthReport {
  status: ComponentStatus;
  timestamp: string;
  version: string;
  components: Record<string, ComponentHealth>;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; latencyMs: number }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { value, latencyMs: Date.now() - start };
  } catch (error) {
    return { error, latencyMs: Date.now() - start };
  }
}

/** Database reachability — a trivial `SELECT 1`. Backs the readiness probe. */
export async function checkDatabaseHealth(): Promise<ComponentHealth> {
  const { error, latencyMs } = await timed(() => prisma.$queryRaw`SELECT 1`);
  if (error) {
    log.error('Database health check failed', { message: error instanceof Error ? error.message : String(error) });
    return { status: 'down', latencyMs, message: 'Database unreachable.' };
  }
  return { status: 'ok', latencyMs };
}

async function checkRedisHealth(): Promise<ComponentHealth> {
  const { REDIS_URL } = getEnv();
  if (!REDIS_URL) {
    return { status: 'not_configured', message: 'REDIS_URL unset — using in-memory cache.' };
  }
  const { value, error, latencyMs } = await timed(async () => {
    const cache = getCache();
    const probeKey = 'health:redis:ping';
    await cache.set(probeKey, '1', 5);
    return cache.get<string>(probeKey);
  });
  if (error || value !== '1') {
    return { status: 'down', latencyMs, message: 'Redis round-trip failed.' };
  }
  return { status: 'ok', latencyMs };
}

async function checkStorage(): Promise<ComponentHealth> {
  const result = await checkStorageHealth();
  if (!result.configured) return { status: 'not_configured', message: result.message };
  return {
    status: result.healthy ? 'ok' : 'down',
    latencyMs: result.latencyMs,
    message: result.healthy ? undefined : result.message,
  };
}

async function checkAiProvider(): Promise<ComponentHealth> {
  if (!isAIProviderConfigured()) {
    return { status: 'not_configured', message: 'No deployment-level AI provider (configured per-organization).' };
  }
  const { value, error, latencyMs } = await timed(() => getAIProvider().health());
  if (error) return { status: 'down', latencyMs, message: 'AI provider ping failed.' };
  if (value && value.healthy === false) return { status: 'down', latencyMs, message: value.message };
  return { status: 'ok', latencyMs };
}

function checkQueue(): ComponentHealth {
  // The queue abstraction is an in-memory stub (jobs run synchronously / via
  // the workflow cron tick). Reported as degraded-but-serving so it never
  // fails readiness, but is visible in the admin health view. Touch getQueue()
  // so a future real backend is exercised here.
  getQueue();
  return {
    status: 'degraded',
    message: 'In-memory queue — synchronous processing / cron-tick, no distributed worker.',
  };
}

/** Aggregate rollup: overall status is the worst non-informational component. */
function rollup(components: Record<string, ComponentHealth>): ComponentStatus {
  const statuses = Object.values(components).map((c) => c.status);
  if (statuses.includes('down')) {
    // A database outage is fatal; any other outage is a degradation.
    return components.database?.status === 'down' ? 'down' : 'degraded';
  }
  if (statuses.includes('degraded')) return 'degraded';
  return 'ok';
}

/** Full health report across every monitored component. */
export async function getHealthReport(): Promise<HealthReport> {
  const [database, redis, storage, ai] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkStorage(),
    checkAiProvider(),
  ]);
  const queue = checkQueue();
  const components = { database, redis, storage, ai, queue };
  return {
    status: rollup(components),
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    components,
  };
}
