import { archiveProjectTool } from './definitions/archive-project.tool';
import { createMeetingTool } from './definitions/create-meeting.tool';
import { createProjectTool } from './definitions/create-project.tool';
import { createTaskTool } from './definitions/create-task.tool';
import { updateProjectTool } from './definitions/update-project.tool';
import type { AnyToolDefinition } from './lib/tool-definition';
import { ToolRegistryService } from './services/tool-registry.service';

/**
 * The ONLY file in this codebase that imports every concrete tool
 * definition. `apps/web/features/planner/` and `apps/web/features/execution/`
 * never import a `*.tool.ts` file directly — they only ever call
 * `registry.get(toolKey, version)` / `registry.list()` on the
 * `ToolRegistryService` instance built here, which is what makes "the
 * execution engine knows nothing about Projects/Tasks/Customers/Documents"
 * literally true. See docs/tool-execution.md.
 */
const ALL_TOOLS: AnyToolDefinition[] = [
  createProjectTool as AnyToolDefinition,
  updateProjectTool as AnyToolDefinition,
  createTaskTool as AnyToolDefinition,
  createMeetingTool as AnyToolDefinition,
  archiveProjectTool as AnyToolDefinition,
];

let instance: ToolRegistryService | undefined;

/** Lazily builds and registers every known tool exactly once per process — same composition-root ethos as every other `getX()` singleton in this codebase. */
export function getToolRegistry(): ToolRegistryService {
  if (!instance) {
    instance = new ToolRegistryService();
    for (const tool of ALL_TOOLS) {
      instance.register(tool);
    }
  }
  return instance;
}
