import { requireAuth } from '@bond-os/auth';
import { sendBondMessageSchema } from '@bond-os/shared';
import { withRateLimit } from '@bond-os/shared/server';

import { runBondChatPipeline } from '@/features/bond/services/rag-pipeline.service';
import { apiHandler, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';
import { createSseStream } from '@/lib/streaming-handler';

/**
 * The RAG pipeline's only entry point (spec §2-3) — an SSE stream, not a
 * JSON envelope, so it bypasses `apiSuccess`. Rate-limited tighter than the
 * shared default: each turn can involve several LLM round-trips (planning
 * + tool calls + the final stream), the most expensive request shape in
 * this codebase.
 */
export const POST = apiHandler(
  withRateLimit(
    async (request) => {
      assertSameOrigin(request);
      const { user } = await requireAuth();
      const organizationId = await requireActiveOrganizationId();
      const body = await parseJsonBody(request, sendBondMessageSchema);

      const generator = runBondChatPipeline(organizationId, user.id, body);
      // Primed here, inside apiHandler's try/catch, so auth/validation/
      // not-found errors before the first event still return as a normal
      // JSON error response — see streaming-handler.ts's doc comment.
      const first = await generator.next();

      return createSseStream(generator, first);
    },
    { limit: 20, windowSeconds: 60 },
  ),
);
