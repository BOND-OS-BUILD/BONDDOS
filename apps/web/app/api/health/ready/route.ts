import { NextResponse } from 'next/server';

import { checkDatabaseHealth } from '@/features/health/services/health.service';

/**
 * Phase 10 — readiness probe. Ready only when the database is reachable (the
 * one hard dependency for serving traffic). Returns 503 otherwise so an
 * orchestrator can pull the instance out of rotation. Unauthenticated.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const database = await checkDatabaseHealth();
  const ready = database.status === 'ok';
  return NextResponse.json(
    { status: ready ? 'ready' : 'not_ready', database: database.status, timestamp: new Date().toISOString() },
    { status: ready ? 200 : 503 },
  );
}
