import { ApprovalService } from '@/features/approvals/services/approval.service';
import { AuditService } from '@/features/audit/services/audit.service';
import { PlannerService } from '@/features/planner/services/planner.service';
import { RollbackService } from '@/features/rollback/services/rollback.service';
import { getToolRegistry } from '@/features/tools/registry';
import type { ToolRegistryService } from '@/features/tools/services/tool-registry.service';
import { ValidationService } from '@/features/tools/services/validation.service';

import { ExecutionService } from '../services/execution.service';
import { PermissionService } from '../services/permission.service';

/**
 * The composition root (Phase 6) — every new service is a class with
 * constructor-injected dependencies, wired up exactly once here, mirroring
 * the `getAIProvider()`/`getEmbeddingProvider()`/`getCache()`/`getQueue()`
 * lazy-singleton pattern already used throughout this codebase. No call
 * site anywhere writes `new ExecutionService(...)` directly. See
 * docs/tool-execution.md.
 */

let toolRegistryService: ToolRegistryService | undefined;
let validationService: ValidationService | undefined;
let permissionService: PermissionService | undefined;
let plannerService: PlannerService | undefined;
let approvalService: ApprovalService | undefined;
let auditService: AuditService | undefined;
let rollbackService: RollbackService | undefined;
let executionService: ExecutionService | undefined;

export function getToolRegistryService(): ToolRegistryService {
  if (!toolRegistryService) toolRegistryService = getToolRegistry();
  return toolRegistryService;
}

export function getValidationService(): ValidationService {
  if (!validationService) validationService = new ValidationService();
  return validationService;
}

export function getPermissionService(): PermissionService {
  if (!permissionService) permissionService = new PermissionService();
  return permissionService;
}

export function getPlannerService(): PlannerService {
  if (!plannerService) {
    plannerService = new PlannerService(getToolRegistryService(), getValidationService(), getPermissionService());
  }
  return plannerService;
}

export function getApprovalService(): ApprovalService {
  if (!approvalService) approvalService = new ApprovalService();
  return approvalService;
}

export function getAuditService(): AuditService {
  if (!auditService) auditService = new AuditService();
  return auditService;
}

export function getRollbackService(): RollbackService {
  if (!rollbackService) rollbackService = new RollbackService(getAuditService());
  return rollbackService;
}

export function getExecutionService(): ExecutionService {
  if (!executionService) {
    executionService = new ExecutionService(
      getToolRegistryService(),
      getValidationService(),
      getApprovalService(),
      getAuditService(),
      getRollbackService(),
      getPlannerService(),
    );
  }
  return executionService;
}
