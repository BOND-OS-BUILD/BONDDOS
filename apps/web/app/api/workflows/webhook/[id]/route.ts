import { withRateLimit } from '@bond-os/shared/server';

import { receiveWorkflowWebhook } from '@/features/workflows/services/workflow-webhook.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';

type Context = { params: Promise<{ id: string }> };

/**
 * Inbound webhook trigger (Phase 8) — `id` is a `WorkflowDefinition.id`
 * (a non-guessable cuid, not the org-scoped `workflowKey`, since this route
 * has no session to resolve which organization a bare key belongs to).
 * No `assertSameOrigin`/`requireAuth` — this is meant to be called by an
 * external service with no BOND OS session; auth is the HMAC signature
 * verified inside `receiveWorkflowWebhook`, not a cookie. See
 * docs/workflows.md.
 */
export const POST = apiHandler<Context>(
  withRateLimit(
    async (request, { params }: Context) => {
      const { id } = await params;
      const rawBody = await request.text();

      const result = await receiveWorkflowWebhook({
        workflowDefinitionId: id,
        signatureHeader: request.headers.get('x-workflow-signature'),
        idempotencyKey: request.headers.get('x-idempotency-key') ?? request.headers.get('idempotency-key'),
        rawBody,
      });

      return apiSuccess(result, { status: result.status === 'accepted' ? 202 : 200 });
    },
    { limit: 30, windowSeconds: 60 },
  ),
);
