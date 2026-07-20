import { ROLE_HIERARCHY, ROLES, type Role } from '@bond-os/shared';

import type { AnyToolDefinition } from '@/features/tools/lib/tool-definition';

/**
 * Computes the role required to approve a plan (Phase 6, §1 of the plan:
 * "requiredRole = max severity across all steps," never client-supplied).
 * A plan mixing a MEMBER-tier step and an ADMIN-tier step requires ADMIN to
 * approve. See docs/approvals.md.
 */
export class PermissionService {
  requiredRoleForTools(tools: AnyToolDefinition[]): Role {
    let required: Role = ROLES.MEMBER;
    for (const tool of tools) {
      const role = tool.permissions();
      if (ROLE_HIERARCHY[role] > ROLE_HIERARCHY[required]) required = role;
    }
    return required;
  }
}
