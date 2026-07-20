import { requireAuth, requireRole } from '@bond-os/auth';
import { getExecutionPlanById } from '@bond-os/database';
import { ROLES } from '@bond-os/shared';
import { logger, withRateLimit } from '@bond-os/shared/server';

import { getExecutionService } from '@/features/execution/lib/container';
import { resumeWorkflowRunByPlanId } from '@/features/workflows/services/workflow-run.service';
import { apiHandler } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';
import { createSseStream } from '@/lib/streaming-handler';

type Context = { params: Promise<{ id: string }> };

const log = logger.child('execution-approve');

/**
 * Wraps the execution generator with a Phase-8-aware completion hook,
 * without `execution.service.ts` (P6) ever importing or knowing about
 * Phase 8 — this file (a route, allowed to know about both) is where that
 * cross-phase awareness lives. `for await`-driving the original generator
 * and re-yielding preserves `createSseStream`'s exact priming/streaming
 * contract; the resume attempt only runs once the underlying generator is
 * exhausted, and never throws into the SSE stream itself (best-effort,
 * matching every other "can't break the caller" event hook in this phase).
 */
async function* withWorkflowResumeHook<T>(
  generator: AsyncGenerator<T>,
  planId: string,
  organizationId: string,
): AsyncGenerator<T> {
  try {
    yield* generator;
  } finally {
    try {
      await resumeWorkflowRunByPlanId(planId, organizationId);
    } catch (error) {
      log.error('Workflow resume-on-approval failed', {
        planId,
        organizationId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * THE gate's HTTP entry point (Phase 6) — an SSE stream, structurally
 * identical to `/api/bond/chat`. `ExecutionService.executeApprovedPlan`'s
 * very first line is `approvalService.approve(...)`; nothing past that runs
 * until the atomic PENDING -> APPROVED transition succeeds, so this route
 * does no approval logic of its own — it only resolves the caller's role
 * and hands off. Rate-limited the same as Mr. Bond's own chat endpoint,
 * since a successful call here triggers real writes.
 */
export const POST = apiHandler<Context>(
  withRateLimit(
    async (request, { params }: Context) => {
      assertSameOrigin(request);
      const { user } = await requireAuth();
      const organizationId = await requireActiveOrganizationId();
      const { id: planId } = await params;

      // MEMBER is just the floor needed to attempt approval at all —
      // ApprovalService.approve() checks the caller's role against the
      // specific plan's own computed requiredRole and throws ForbiddenError
      // itself; that real check is never duplicated or second-guessed here.
      const { membership } = await requireRole(organizationId, ROLES.MEMBER);

      // Carry the plan's own conversationId through (if it was proposed
      // from a Mr. Bond chat turn) so the outcome message lands back in
      // that conversation instead of being silently dropped.
      const plan = await getExecutionPlanById(planId, organizationId);

      const rawGenerator = getExecutionService().executeApprovedPlan(
        { organizationId, userId: user.id, conversationId: plan?.conversationId ?? undefined },
        planId,
        membership.role,
      );
      const generator = withWorkflowResumeHook(rawGenerator, planId, organizationId);

      // Primed here, inside apiHandler's try/catch, so a lost approval race
      // (or any other pre-stream error) still returns a normal JSON error
      // response — see streaming-handler.ts's doc comment.
      const first = await generator.next();

      return createSseStream(generator, first);
    },
    { limit: 20, windowSeconds: 60 },
  ),
);
