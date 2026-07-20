import { Prisma } from '../generated/index.js';
import { prisma } from '../client';

/**
 * Webhook replay protection (Phase 8) — a dedicated table specifically
 * because the uniqueness-as-enforcement idiom needs a real DB constraint,
 * not an application-level check-then-insert (a genuine TOCTOU race between
 * two concurrent deliveries of the same idempotency key). See docs/workflows.md.
 */

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Atomically records a delivery attempt. Returns `false` (never throws) if `idempotencyKey` was already recorded for this workflow — a genuine replay, not an error. */
export async function recordWebhookDelivery(workflowDefinitionId: string, idempotencyKey: string): Promise<boolean> {
  try {
    await prisma.workflowWebhookDelivery.create({ data: { workflowDefinitionId, idempotencyKey } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_CONSTRAINT_VIOLATION) {
      return false;
    }
    throw error;
  }
}
