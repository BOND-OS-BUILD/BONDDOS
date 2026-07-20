import { getEmailProvider } from '@bond-os/auth';
import { getMembership, prisma } from '@bond-os/database';
import { ForbiddenError, ValidationError } from '@bond-os/shared';
import { logger } from '@bond-os/shared/server';

import type { WorkflowStepHandler, WorkflowStepHandlerContext } from '../lib/step-handler';

const log = logger.child('workflow-notification');

/**
 * NOTIFICATION — the one step type that is NOT run-fatal on failure by
 * default (`continueOnFailure: true`), since a Workflow's real work
 * (writes, agent turns) already succeeded by the time a notification would
 * fail — an SMTP outage shouldn't roll back or fail an otherwise-completed
 * run. Persists its own outcome as a `workflow.notification` Event
 * (`event-bus.service.ts`'s `isDispatchEligible` denylists `workflow.*`
 * from ever being a trigger match, so this can never re-enter dispatch).
 *
 * `to` is restricted to a CURRENT MEMBER of the triggering organization — a
 * design review correctly flagged that Notification has no approval gate
 * (unlike INVOKE_TOOL/INVOKE_AGENT, it's meant to be a lightweight, low-risk
 * step, matching the spec's own "Notifications: workflow started/completed/
 * failed" system-alert framing), so an unrestricted external recipient
 * would let any org member author a workflow that reads org data and mails
 * it to an arbitrary outside address with no review at all. Restricting the
 * recipient to the org closes that data-exfiltration path while preserving
 * Notification's intended unapproved, internal-alert nature.
 */
export const notificationHandler: WorkflowStepHandler = {
  stepType: 'NOTIFICATION',
  async execute(ctx: WorkflowStepHandlerContext, params) {
    const to = params.to;
    const subject = params.subject;
    const body = params.body;
    if (typeof to !== 'string' || !to) throw new ValidationError('NOTIFICATION: "to" is required.');
    if (typeof subject !== 'string' || !subject) throw new ValidationError('NOTIFICATION: "subject" is required.');
    if (typeof body !== 'string' || !body) throw new ValidationError('NOTIFICATION: "body" is required.');

    const recipient = await prisma.user.findUnique({ where: { email: to } });
    const recipientMembership = recipient ? await getMembership(recipient.id, ctx.organizationId) : null;
    if (!recipientMembership) {
      throw new ForbiddenError(`NOTIFICATION: "${to}" is not a member of this organization — recipients must be current org members.`);
    }

    const { publishEvent } = await import('../services/event-bus.service');

    try {
      await getEmailProvider().send({ to, subject, html: body, text: body });
      await publishEvent({
        organizationId: ctx.organizationId,
        eventType: 'workflow.notification',
        source: 'SYSTEM',
        payload: { runId: ctx.runId, workflowDefinitionId: ctx.workflowDefinitionId, to, subject, status: 'sent' },
        entityType: 'WORKFLOW_RUN',
        entityId: ctx.runId,
      });
      return { kind: 'succeeded', output: { to, subject, status: 'sent' } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Notification send failed', { runId: ctx.runId, to, message });
      await publishEvent({
        organizationId: ctx.organizationId,
        eventType: 'workflow.notification',
        source: 'SYSTEM',
        payload: { runId: ctx.runId, workflowDefinitionId: ctx.workflowDefinitionId, to, subject, status: 'failed', error: message },
        entityType: 'WORKFLOW_RUN',
        entityId: ctx.runId,
      });
      return { kind: 'failed', error: message, continueOnFailure: true };
    }
  },
};
