import { NextResponse } from 'next/server';

import { buildOpenApiDocument } from '@/features/api-v1/openapi';

/**
 * Phase 11 — the machine-readable API contract. Public (no key required) so
 * codegen tools and Swagger UI can fetch it. Returns the raw OpenAPI document
 * (not wrapped in the `ApiResponse` envelope).
 */
export const dynamic = 'force-dynamic';

export function GET(request: Request): NextResponse {
  const origin = new URL(request.url).origin;
  return NextResponse.json(buildOpenApiDocument(origin));
}
