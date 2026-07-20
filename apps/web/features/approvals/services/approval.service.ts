import {
  createApprovalRequest,
  expireStaleApprovalRequests,
  getApprovalRequestByPlanId,
  transitionApprovalRequest,
  type ApprovalRequestData,
} from '@bond-os/database';
import { ConflictError, ForbiddenError, NotFoundError, roleSatisfies, type Role } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

/**
 * Dynamically imported, not statically — `event-bus.service.ts` is already,
 * today, transitively reachable FROM `ApprovalService`: `publishEvent()` ->
 * (INVOKE_TOOL step) -> `proposeAction` -> `execution/lib/container.ts` ->
 * `ApprovalService`. A static top-level `import { publishEvent } from
 * '.../event-bus.service'` here would close that into a genuine circular
 * module graph; the dynamic import defers resolution past both modules'
 * top-level evaluation, exactly like every curated call site in
 * docs/event-bus.md. This is a verified correctness requirement (the import
 * graph was traced, not assumed), not a stylistic default.
 */
async function getPublishEvent() {
  const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
  return publishEvent;
}

/**
 * The approval gate (Phase 6). Single-use/replay protection is an atomic,
 * org-scoped conditional `updateMany` (`transitionApprovalRequest`), not a
 * signed token — see docs/approvals.md for why a signature was considered
 * and dropped. Phase 9 additive: each transition also publishes an
 * `approval.*` Event, which `notifyFromEvent` fans out to whoever holds the
 * plan's required role — see docs/notifications.md.
 */
export class ApprovalService {
  async requestApproval(organizationId: string, planId: string, requiredRole: Role): Promise<ApprovalRequestData> {
    const expiresAt = new Date(Date.now() + getEnv().APPROVAL_EXPIRY_MINUTES * 60 * 1000);
    const request = await createApprovalRequest({ planId, organizationId, requiredRole, expiresAt });

    const publishEvent = await getPublishEvent();
    await publishEvent({
      organizationId,
      eventType: 'approval.requested',
      source: 'SYSTEM',
      payload: { planId, requiredRole },
      entityType: 'EXECUTION_PLAN',
      entityId: planId,
    });

    return request;
  }

  async getForPlan(organizationId: string, planId: string): Promise<ApprovalRequestData> {
    await expireStaleApprovalRequests(organizationId);
    const approval = await getApprovalRequestByPlanId(planId, organizationId);
    if (!approval) throw new NotFoundError('Approval request not found.');
    return approval;
  }

  /**
   * Atomically transitions `PENDING` -> `APPROVED`. Throws `ForbiddenError`
   * if the caller's role doesn't meet the plan's own computed
   * `requiredRole` (never a generic MEMBER-only check), and `ConflictError`
   * if the race was already lost (double-click, replay, or genuinely
   * expired) — the DB's conditional `updateMany` is the actual single-use
   * enforcement, this method just surfaces its result as the right error.
   */
  async approve(organizationId: string, userId: string, planId: string, callerRole: Role): Promise<ApprovalRequestData> {
    await expireStaleApprovalRequests(organizationId);
    const approval = await getApprovalRequestByPlanId(planId, organizationId);
    if (!approval) throw new NotFoundError('Approval request not found.');

    if (!roleSatisfies(callerRole, approval.requiredRole)) {
      throw new ForbiddenError(`Approving this plan requires the ${approval.requiredRole} role.`);
    }

    const won = await transitionApprovalRequest(approval.id, organizationId, 'APPROVED', userId);
    if (!won) {
      throw new ConflictError('This approval request is no longer pending (already approved, rejected, or expired).');
    }

    const publishEvent = await getPublishEvent();
    await publishEvent({
      organizationId,
      eventType: 'approval.approved',
      source: 'SYSTEM',
      payload: { planId, approvedById: userId },
      entityType: 'EXECUTION_PLAN',
      entityId: planId,
    });

    return { ...approval, status: 'APPROVED', approvedById: userId, approvedAt: new Date() };
  }

  async reject(organizationId: string, planId: string): Promise<void> {
    const approval = await this.getForPlan(organizationId, planId);
    const won = await transitionApprovalRequest(approval.id, organizationId, 'REJECTED');
    if (!won) {
      throw new ConflictError('This approval request is no longer pending (already approved, rejected, or expired).');
    }

    const publishEvent = await getPublishEvent();
    await publishEvent({
      organizationId,
      eventType: 'approval.rejected',
      source: 'SYSTEM',
      payload: { planId },
      entityType: 'EXECUTION_PLAN',
      entityId: planId,
    });
  }
}
