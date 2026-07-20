import { prisma } from '@bond-os/database';
import { ROLE_HIERARCHY } from '@bond-os/shared';

import type { StepCondition } from './dag';

/**
 * Plan-step conditions (Phase 6) are plain predicate functions, not full
 * Tools — they're read-only checks with no approval/rollback semantics of
 * their own, evaluated fresh immediately before the step that declares them
 * runs (never cached from plan-creation time — that's the whole point of
 * "IF EXISTS", checking live state). See docs/planner.md.
 */

export type ConditionPredicate = (organizationId: string, args: Record<string, unknown>) => Promise<boolean>;

const CONDITIONS: Record<string, ConditionPredicate> = {
  /** Used by the `create_project`/`update_project` IF-EXISTS/ELSE plan template — see `apps/web/features/planner/services/planner.service.ts`. */
  async project_exists_by_title(organizationId, args) {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) return false;
    const project = await prisma.project.findFirst({ where: { organizationId, title } });
    return project !== null;
  },

  /**
   * Phase 8: Workflow "User filters" — a named predicate (not a plain
   * payload comparison, since it needs a live DB lookup) used by
   * `WorkflowConditionNode`'s `predicate` leaf type, extending this same
   * registry rather than duplicating the AND/OR/NOT tree logic elsewhere —
   * see `apps/web/features/workflows/lib/workflow-condition.ts`.
   */
  async user_has_role(organizationId, args) {
    const userId = typeof args.userId === 'string' ? args.userId : '';
    const role = typeof args.role === 'string' ? args.role : '';
    if (!userId || !role) return false;
    const membership = await prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } });
    if (!membership) return false;
    return ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY[role as keyof typeof ROLE_HIERARCHY];
  },
};

export function isKnownConditionPredicate(name: string): boolean {
  return name in CONDITIONS;
}

export async function evaluateCondition(organizationId: string, condition: StepCondition): Promise<boolean> {
  const predicate = CONDITIONS[condition.predicate];
  if (!predicate) throw new Error(`Unknown condition predicate: "${condition.predicate}".`);

  const result = await predicate(organizationId, condition.args);
  return condition.negate ? !result : result;
}
