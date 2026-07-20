import { prisma } from '../client';
import type { ApprovalStatus, Role } from '../generated/index.js';

/**
 * The approval gate (Phase 6). Single-use/replay protection is an atomic,
 * org-scoped conditional `updateMany` (never a plain `findFirst` + `update`
 * pair, which would race) — see docs/approvals.md for why a signed token
 * was considered and dropped in favor of this.
 */

export interface ApprovalRequestData {
  id: string;
  planId: string;
  organizationId: string;
  requiredRole: Role;
  status: ApprovalStatus;
  approvedById: string | null;
  approvedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreateApprovalRequestData {
  planId: string;
  organizationId: string;
  requiredRole: Role;
  expiresAt: Date;
}

export async function createApprovalRequest(data: CreateApprovalRequestData): Promise<ApprovalRequestData> {
  return prisma.approvalRequest.create({ data });
}

export async function getApprovalRequestByPlanId(
  planId: string,
  organizationId: string,
): Promise<ApprovalRequestData | null> {
  return prisma.approvalRequest.findFirst({ where: { planId, organizationId } });
}

/**
 * The single-use enforcement mechanism: `status` only transitions from
 * `PENDING` to `APPROVED`/`REJECTED` if it's still `PENDING` and not
 * expired, atomically, in the same query as the tenant filter. Returns
 * `true` only if this call was the one that won the race — a second
 * concurrent call (double-click, replay) sees `count === 0` and returns
 * `false`.
 */
export async function transitionApprovalRequest(
  id: string,
  organizationId: string,
  toStatus: Extract<ApprovalStatus, 'APPROVED' | 'REJECTED' | 'CANCELLED'>,
  approvedById?: string,
): Promise<boolean> {
  const result = await prisma.approvalRequest.updateMany({
    where: { id, organizationId, status: 'PENDING', expiresAt: { gt: new Date() } },
    data: {
      status: toStatus,
      approvedById: toStatus === 'APPROVED' ? approvedById : undefined,
      approvedAt: toStatus === 'APPROVED' ? new Date() : undefined,
    },
  });
  return result.count === 1;
}

/** Flags any PENDING-but-past-`expiresAt` rows for an organization as EXPIRED — called opportunistically when an approval is looked up, mirroring the "no real worker loop, checked on access" honesty already established for jobs/sync. */
export async function expireStaleApprovalRequests(organizationId: string): Promise<number> {
  const result = await prisma.approvalRequest.updateMany({
    where: { organizationId, status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}
