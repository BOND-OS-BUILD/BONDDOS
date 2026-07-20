import { createHmac } from 'node:crypto';

import {
  createEvent,
  getWorkflowDefinitionByIdUnscoped,
  recordWebhookDelivery,
  type Prisma,
  type WorkflowDefinitionData,
} from '@bond-os/database';
import { ForbiddenError, NotFoundError, ValidationError } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

import { createWorkflowDispatchBudget, enterWorkflowDispatch } from '../lib/workflow-dispatch-budget';
import { secureCompare } from '../lib/secure-compare';
import { startWorkflowRun } from './workflow-run.service';

export interface InboundWebhookInput {
  workflowDefinitionId: string;
  signatureHeader: string | null;
  idempotencyKey: string | null;
  rawBody: string;
}

export type InboundWebhookResult = { status: 'accepted' } | { status: 'duplicate' };

function computeSignature(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Inbound webhook trigger (Phase 8) — the one door a caller with no BOND OS
 * session can use to start a workflow. Every acceptance requires, in order:
 * (1) the target `WorkflowDefinition` exists, is `ACTIVE`, has
 * `triggerType: WEBHOOK`, and has a `webhookSecret` configured — anything
 * else fails closed as 404, never revealing which reason; (2) a valid HMAC-
 * SHA256 signature over the raw body, compared via `secureCompare`, never
 * `===`; (3) a not-yet-seen idempotency key, enforced by
 * `recordWebhookDelivery`'s real unique-constraint insert (atomic, not a
 * check-then-insert race). "Unverified external webhooks" is explicitly
 * excluded by this codebase's Do-NOT-Build list — there is no code path
 * here that starts a run without all three checks passing. See
 * docs/workflows.md.
 */
export async function receiveWorkflowWebhook(input: InboundWebhookInput): Promise<InboundWebhookResult> {
  const definition = await getWorkflowDefinitionByIdUnscoped(input.workflowDefinitionId);
  if (!definition || definition.status !== 'ACTIVE' || definition.triggerType !== 'WEBHOOK' || !definition.webhookSecret) {
    throw new NotFoundError('Not found.');
  }

  if (!input.signatureHeader) throw new ValidationError('Missing signature header.');
  if (!input.idempotencyKey) throw new ValidationError('Missing idempotency key header.');

  const expected = computeSignature(definition.webhookSecret, input.rawBody);
  if (!secureCompare(input.signatureHeader, expected)) throw new ForbiddenError('Invalid webhook signature.');

  const recorded = await recordWebhookDelivery(definition.id, input.idempotencyKey);
  if (!recorded) return { status: 'duplicate' };

  await dispatchWebhookRun(definition, input.rawBody);
  return { status: 'accepted' };
}

async function dispatchWebhookRun(definition: WorkflowDefinitionData, rawBody: string): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    payload = { raw: rawBody };
  }

  const event = await createEvent({
    organizationId: definition.organizationId,
    eventType: 'webhook.received',
    source: 'SYSTEM',
    payload: payload as unknown as Prisma.InputJsonValue,
    correlationId: crypto.randomUUID(),
    metadata: { workflowDefinitionId: definition.id },
  });

  const env = getEnv();
  const budget = createWorkflowDispatchBudget(env.WORKFLOW_MAX_SYNC_STEPS, env.WORKFLOW_MAX_SYNC_MS);
  enterWorkflowDispatch(budget, definition.id);
  await startWorkflowRun(definition, event, budget);
}
