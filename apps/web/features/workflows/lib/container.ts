import { WorkflowDefinitionService } from '../services/workflow-definition.service';
import { WorkflowRunService } from '../services/workflow-run.query-service';

/**
 * The composition root for the Workflows feature (Phase 8) — mirrors
 * `execution/lib/container.ts`'s lazy-constructor-injection pattern
 * exactly. See docs/workflows.md.
 */

let workflowDefinitionService: WorkflowDefinitionService | undefined;
let workflowRunService: WorkflowRunService | undefined;

export function getWorkflowDefinitionService(): WorkflowDefinitionService {
  if (!workflowDefinitionService) workflowDefinitionService = new WorkflowDefinitionService();
  return workflowDefinitionService;
}

export function getWorkflowRunService(): WorkflowRunService {
  if (!workflowRunService) workflowRunService = new WorkflowRunService();
  return workflowRunService;
}
