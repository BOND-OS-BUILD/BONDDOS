import type { Role, RollbackSupport, ToolCategory } from '@bond-os/database';
import type { ZodType, ZodTypeDef } from 'zod';

/** `ZodType<Output>` alone assumes the schema's pre-parse input type equals `Output` too — but every reference tool's params schema has `.default(...)` fields (raw input has optional properties, parsed output does not), which fails that check. Loosening the 3rd (`Input`) generic to `any` decouples them: `TParams`/`TResult` describe the PARSED shape `execute()` etc. receive, not the raw pre-parse input. */
type AnyInputZodType<Output> = ZodType<Output, ZodTypeDef, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The generic Tool SDK (Phase 6). Every tool implements exactly this
 * contract — no custom entry points. The execution engine, planner, and
 * registry only ever call these 8 methods; none of them know what a
 * "Project" or "Task" is. See docs/tool-execution.md.
 */

export interface ToolContext {
  organizationId: string;
  userId: string;
  conversationId?: string;
}

export interface ToolValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ToolPreviewChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ToolPreviewResult {
  summary: string;
  changes: ToolPreviewChange[];
}

export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  readonly toolKey: string;
  readonly version: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: ToolCategory;
  readonly icon: string;
  readonly estimatedExecutionMs: number;
  readonly rollbackSupport: RollbackSupport;
  readonly supportsPreview: boolean;
  readonly supportsDryRun: boolean;
  readonly supportsTransactions: boolean;
  readonly requiresApproval: boolean;

  /** The Zod schemas that validate `execute()`'s params and result — also the source of the DB `Tool.parametersSchema`/`outputSchema` JSON Schema snapshot. */
  schema(): { parameters: AnyInputZodType<TParams>; output: AnyInputZodType<TResult> };

  /** The minimum role required to approve a plan containing this tool. Fixed per-tool for every current reference tool; declared as a method (not a static field) so a future tool could vary it by params. */
  permissions(): Role;

  /** A rough execution-time estimate in ms, shown on the approval card. */
  estimate(ctx: ToolContext, params: TParams): Promise<number>;

  /** Structural/business validation beyond the Zod schema — e.g. does a referenced record belong to this organization. Called before a plan is ever shown for approval. */
  validate(ctx: ToolContext, params: TParams): Promise<ToolValidationResult>;

  /** Dry-run: produces a human-readable before/after diff with NO data mutation. */
  preview(ctx: ToolContext, params: TParams): Promise<ToolPreviewResult>;

  /** The real write. Only ever invoked by `ExecutionService` after `ApprovalRequest.status` has atomically transitioned to `APPROVED`. */
  execute(ctx: ToolContext, params: TParams): Promise<TResult>;

  /** Reverses `execute()`'s effect. Only ever invoked when `rollbackSupport !== 'NOT_SUPPORTED'`. */
  rollback(ctx: ToolContext, result: TResult): Promise<void>;

  /** One-line human summary for the approval card, built from validated `params` — never from raw LLM text. */
  describe(params: TParams): string;
}

/** Type-erased view used by the registry/engine/planner, which operate on tools generically without knowing any concrete `TParams`/`TResult`. */
export type AnyToolDefinition = ToolDefinition<unknown, unknown>;
