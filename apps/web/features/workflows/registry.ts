import type { WorkflowStepType } from '@bond-os/database';

import { branchHandler } from './step-handlers/branch.handler';
import { delayHandler } from './step-handlers/delay.handler';
import { generateReportHandler } from './step-handlers/generate-report.handler';
import { invokeAgentHandler } from './step-handlers/invoke-agent.handler';
import { invokeToolHandler } from './step-handlers/invoke-tool.handler';
import { loopHandler } from './step-handlers/loop.handler';
import { notificationHandler } from './step-handlers/notification.handler';
import { readDataHandler } from './step-handlers/read-data.handler';
import { searchKnowledgeHandler } from './step-handlers/search-knowledge.handler';
import { waitHandler } from './step-handlers/wait.handler';
import type { WorkflowStepHandler } from './lib/step-handler';

/**
 * The ONLY file in this codebase that imports every concrete step-handler
 * implementation — mirrors `apps/web/features/tools/registry.ts`/
 * `apps/web/features/agents/registry.ts` exactly. `event-bus.service.ts`
 * and `workflow-run.service.ts` only ever call `registry.get(stepType)`,
 * never import a concrete `*.handler.ts` file directly. See
 * docs/workflow-builder.md.
 */
const ALL_HANDLERS: WorkflowStepHandler[] = [
  readDataHandler,
  searchKnowledgeHandler,
  invokeAgentHandler,
  invokeToolHandler,
  waitHandler,
  branchHandler,
  delayHandler,
  loopHandler,
  notificationHandler,
  generateReportHandler,
];

export class WorkflowStepHandlerRegistry {
  private readonly handlers = new Map<WorkflowStepType, WorkflowStepHandler>();

  register(handler: WorkflowStepHandler): void {
    this.handlers.set(handler.stepType, handler);
  }

  get(stepType: WorkflowStepType): WorkflowStepHandler | undefined {
    return this.handlers.get(stepType);
  }

  list(): WorkflowStepHandler[] {
    return Array.from(this.handlers.values());
  }
}

let instance: WorkflowStepHandlerRegistry | undefined;

/** Lazily builds and registers every known step handler exactly once per process — same composition-root ethos as `getToolRegistry()`/`getAgentRegistry()`. */
export function getWorkflowStepHandlerRegistry(): WorkflowStepHandlerRegistry {
  if (!instance) {
    instance = new WorkflowStepHandlerRegistry();
    for (const handler of ALL_HANDLERS) {
      instance.register(handler);
    }
  }
  return instance;
}
