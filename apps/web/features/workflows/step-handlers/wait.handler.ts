import { ValidationError } from '@bond-os/shared';

import type { WorkflowStepHandler } from '../lib/step-handler';

/**
 * WAIT — pauses until a specific point in time (as opposed to DELAY's
 * fixed duration from now). Same single-invocation contract as DELAY — see
 * that handler's doc comment.
 */
export const waitHandler: WorkflowStepHandler = {
  stepType: 'WAIT',
  async execute(_ctx, params) {
    const until = params.until;
    if (typeof until !== 'string') throw new ValidationError('WAIT: "until" (an ISO timestamp) is required.');

    const waitUntil = new Date(until);
    if (Number.isNaN(waitUntil.getTime())) throw new ValidationError(`WAIT: "until" is not a valid timestamp: "${until}".`);
    if (waitUntil.getTime() <= Date.now()) return { kind: 'succeeded', output: { waitedUntil: until } };

    return { kind: 'waiting_timer', waitUntil };
  },
};
