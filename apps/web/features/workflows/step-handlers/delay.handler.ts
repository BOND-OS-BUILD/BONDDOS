import { ValidationError } from '@bond-os/shared';

import type { WorkflowStepHandler } from '../lib/step-handler';

const MAX_DELAY_MS = 1000 * 60 * 60 * 24 * 30; // 30 days — a sane upper bound, not an arbitrary one; nothing in this codebase runs a workflow run open-ended.

/**
 * DELAY — waits a fixed duration from when this step first ran.
 * `execute()` only ever runs ONCE, to compute `waitUntil`; the driver
 * (`workflow-run.service.ts`) resumes a `WAITING_TIMER` step directly once
 * `waitUntil` has passed, without calling this handler again — re-calling
 * it on resume would recompute a fresh `durationMs`-from-now and the wait
 * would never actually elapse.
 */
export const delayHandler: WorkflowStepHandler = {
  stepType: 'DELAY',
  async execute(_ctx, params) {
    const durationMs = params.durationMs;
    if (typeof durationMs !== 'number' || durationMs <= 0) throw new ValidationError('DELAY: "durationMs" must be a positive number.');
    if (durationMs > MAX_DELAY_MS) throw new ValidationError(`DELAY: "durationMs" must not exceed ${MAX_DELAY_MS}ms (30 days).`);

    return { kind: 'waiting_timer', waitUntil: new Date(Date.now() + durationMs) };
  },
};
