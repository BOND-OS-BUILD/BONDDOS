import { graphql } from 'graphql';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveApiKeyContext } from '@/features/api-keys/auth/api-auth';
import { createRootValue, graphqlSchema } from '@/features/graphql/schema';
import { enforceRateLimit } from '@/features/rate-limits/services/rate-limit.service';
import { apiHandler, parseJsonBody } from '@/lib/api-handler';

/**
 * Phase 11 — read-only GraphQL endpoint. Authenticates with an API key (same as
 * REST), rate-limited per key, and executes against a schema whose resolvers
 * reuse the public read services (per-field scope checks inside). GET returns
 * the SDL for discovery; POST executes a query.
 */
export const dynamic = 'force-dynamic';

const graphqlRequestSchema = z.object({
  query: z.string().min(1),
  variables: z.record(z.unknown()).optional(),
  operationName: z.string().optional(),
});

export const GET = apiHandler(async (request) => {
  // Discovery: return the SDL (still requires a valid key).
  await resolveApiKeyContext(request);
  const { printSchema } = await import('graphql');
  return new Response(printSchema(graphqlSchema), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
});

export const POST = apiHandler(async (request) => {
  const context = await resolveApiKeyContext(request);
  await enforceRateLimit({
    scope: 'API',
    identifier: context.keyId,
    request,
    userId: context.userId,
    organizationId: context.organizationId,
  });

  const body = await parseJsonBody(request, graphqlRequestSchema);
  const result = await graphql({
    schema: graphqlSchema,
    source: body.query,
    rootValue: createRootValue(context),
    variableValues: body.variables,
    operationName: body.operationName,
  });
  // GraphQL responses carry their own { data, errors } envelope.
  return NextResponse.json(result);
});
