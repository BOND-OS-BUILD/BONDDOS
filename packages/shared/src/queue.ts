import 'server-only';

import { logger } from './logger';

export type JobPayload = Record<string, unknown>;

export interface EnqueueResult {
  jobId: string;
}

/**
 * Background job queue abstraction ("Background Architecture" — prepare the
 * interface, no workers). Ships with a zero-config in-memory implementation
 * that only records enqueue calls; nothing processes them (no worker loop).
 * Swap for a BullMQ/Redis-backed implementation later without touching call
 * sites — same interface-first pattern as `Cache`/`RateLimiter`.
 */
export interface Queue {
  enqueue(jobName: string, payload: JobPayload): Promise<EnqueueResult>;
}

class InMemoryQueue implements Queue {
  private log = logger.child('queue');
  private counter = 0;

  async enqueue(jobName: string, payload: JobPayload): Promise<EnqueueResult> {
    this.counter += 1;
    const jobId = `local-${jobName}-${this.counter}`;
    this.log.info(`Enqueued "${jobName}" (in-memory only — no worker processes it yet)`, { jobId, payload });
    return { jobId };
  }
}

let instance: Queue | undefined;

export function getQueue(): Queue {
  if (!instance) {
    instance = new InMemoryQueue();
  }
  return instance;
}
