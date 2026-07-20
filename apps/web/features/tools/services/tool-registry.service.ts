import { upsertTool } from '@bond-os/database';

import type { AnyToolDefinition } from '../lib/tool-definition';

/**
 * The single source of truth for which tools exist (Phase 6). Concrete tool
 * modules never register themselves globally — `apps/web/features/tools/registry.ts`
 * is the ONLY file that imports every concrete tool and calls `register()`;
 * the Planner/Execution Engine only ever call `get()`/`list()` on an
 * instance of this class, never import a concrete tool module directly.
 * This is what makes "the execution engine knows nothing about Projects/
 * Tasks/Customers/Documents" literally true. See docs/tool-execution.md.
 */
export class ToolRegistryService {
  private readonly tools = new Map<string, AnyToolDefinition>();
  private syncPromise: Promise<void> | null = null;

  register(tool: AnyToolDefinition): void {
    this.tools.set(this.key(tool.toolKey, tool.version), tool);
  }

  get(toolKey: string, version: string): AnyToolDefinition | undefined {
    return this.tools.get(this.key(toolKey, version));
  }

  /** Highest registered version for a `toolKey` — used when a caller doesn't pin a specific version. */
  getLatest(toolKey: string): AnyToolDefinition | undefined {
    const candidates = this.list().filter((tool) => tool.toolKey === toolKey);
    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) => Number(b.version) - Number(a.version))[0];
  }

  list(): AnyToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Idempotently upserts every registered tool's static metadata into the
   * `Tool` table — cheap enough on cold start, same lazy-once-per-process
   * ethos as every other composition-root singleton in this codebase.
   * `parametersSchema`/`outputSchema` store a minimal placeholder (this
   * codebase has no Zod-to-JSON-Schema conversion utility, and validation
   * always goes through the real in-memory Zod schema, never this column —
   * the DB copy exists for discovery/historical display only, not as the
   * validation hot path).
   */
  async syncToDatabase(): Promise<void> {
    if (!this.syncPromise) {
      this.syncPromise = Promise.all(
        this.list().map((tool) =>
          upsertTool({
            toolKey: tool.toolKey,
            version: tool.version,
            name: tool.name,
            displayName: tool.displayName,
            description: tool.description,
            category: tool.category,
            icon: tool.icon,
            minimumRole: tool.permissions(),
            parametersSchema: { note: 'Defined in code; validated via the live Zod schema, not this snapshot.' },
            outputSchema: { note: 'Defined in code; validated via the live Zod schema, not this snapshot.' },
            supportsRollback: tool.rollbackSupport !== 'NOT_SUPPORTED',
            rollbackSupport: tool.rollbackSupport,
            supportsPreview: tool.supportsPreview,
            supportsDryRun: tool.supportsDryRun,
            supportsTransactions: tool.supportsTransactions,
            requiresApproval: tool.requiresApproval,
            estimatedExecutionMs: tool.estimatedExecutionMs,
          }),
        ),
      ).then(() => undefined);
    }
    await this.syncPromise;
  }

  private key(toolKey: string, version: string): string {
    return `${toolKey}@${version}`;
  }
}
