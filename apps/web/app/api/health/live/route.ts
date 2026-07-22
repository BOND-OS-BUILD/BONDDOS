import { NextResponse } from 'next/server';

/**
 * Phase 10 — liveness probe. Answers "is the process up and serving?" with no
 * downstream dependency checks, so it stays 200 even during a database
 * outage (that's what readiness is for). Unauthenticated.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}
