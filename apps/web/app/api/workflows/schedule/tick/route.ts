import { NotFoundError } from '@bond-os/shared';
import { getEnv, withRateLimit } from '@bond-os/shared/server';

import { secureCompare } from '@/features/workflows/lib/secure-compare';
import { runWorkflowTick } from '@/features/workflows/services/workflow-tick.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';

/**
 * The only door into time-based workflow execution (Phase 8) — Scheduled
 * triggers and Delay/Wait-step resumption both go through here. Meant to be
 * called periodically by an external caller (Vercel Cron, a GitHub Actions
 * scheduled workflow, or an OS-level Task Scheduler entry) against
 * `CRON_SECRET` as a bearer token — never by a browser session, so this
 * intentionally has no CSRF check (no cookie/session exists to hijack) and
 * no `requireAuth` (there is no user). Fails closed (404, not 401/403) both
 * when `CRON_SECRET` is unset and when the provided secret doesn't match —
 * an unauthenticated prober should not be able to tell this endpoint exists
 * at all. See docs/scheduling.md.
 */
export const POST = apiHandler(
  withRateLimit(
    async (request) => {
      const env = getEnv();
      if (!env.CRON_SECRET) throw new NotFoundError('Not found.');

      const provided = request.headers.get('authorization');
      const expected = `Bearer ${env.CRON_SECRET}`;
      if (!provided || !secureCompare(provided, expected)) throw new NotFoundError('Not found.');

      const result = await runWorkflowTick();
      return apiSuccess(result);
    },
    { limit: 6, windowSeconds: 60 },
  ),
);
