import { NextResponse } from 'next/server';

import { getHealthReport } from '@/features/health/services/health.service';

/**
 * Phase 10 — unauthenticated deployment health probe (load balancers,
 * uptime monitors). Returns 200 unless the deployment is `down` (database
 * unreachable), in which case 503. Internal error messages are intentionally
 * omitted here — the full detail (messages, per-component errors) is exposed
 * only through the platform-admin System Health view.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const report = await getHealthReport();
    const components = Object.fromEntries(
      Object.entries(report.components).map(([name, health]) => [
        name,
        { status: health.status, ...(health.latencyMs !== undefined ? { latencyMs: health.latencyMs } : {}) },
      ]),
    );
    return NextResponse.json(
      { status: report.status, timestamp: report.timestamp, version: report.version, components },
      { status: report.status === 'down' ? 503 : 200 },
    );
  } catch {
    return NextResponse.json(
      { status: 'down', timestamp: new Date().toISOString(), message: 'Health check failed.' },
      { status: 503 },
    );
  }
}
