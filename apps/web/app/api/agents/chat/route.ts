import { requireAuth } from '@bond-os/auth';
import { agentChatSchema } from '@bond-os/shared';
import { withRateLimit } from '@bond-os/shared/server';

import { runAgentChatPipeline } from '@/features/agents/services/agent-chat.service';
import { apiHandler, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';
import { createSseStream } from '@/lib/streaming-handler';

/**
 * The multi-agent pipeline's entry point — an SSE stream, not a JSON
 * envelope, so it bypasses `apiSuccess`. Mirrors `/api/bond/chat` exactly;
 * rate-limited the same since each turn can involve several LLM round-trips
 * (planning + delegation + the final stream).
 */
export const POST = apiHandler(
  withRateLimit(
    async (request) => {
      assertSameOrigin(request);
      const { user } = await requireAuth();
      const organizationId = await requireActiveOrganizationId();
      const body = await parseJsonBody(request, agentChatSchema);

      const generator = runAgentChatPipeline(organizationId, user.id, body);
      // Primed here, inside apiHandler's try/catch, so auth/validation/
      // not-found errors before the first event still return as a normal
      // JSON error response — see streaming-handler.ts's doc comment.
      const first = await generator.next();

      return createSseStream(generator, first);
    },
    { limit: 20, windowSeconds: 60 },
  ),
);
