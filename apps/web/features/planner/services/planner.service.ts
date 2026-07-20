import { createExecutionPlan, type ExecutionPlanData, type Prisma, type Role, type RollbackSupport } from '@bond-os/database';
import { hashContent } from '@bond-os/parsers';
import { ValidationError } from '@bond-os/shared';

import type { AnyToolDefinition, ToolContext } from '@/features/tools/lib/tool-definition';
import type { ToolRegistryService } from '@/features/tools/services/tool-registry.service';
import type { ValidationService } from '@/features/tools/services/validation.service';

import { computeLayers, validatePlanSteps, type ExecutionStepDefinition, type PlanGraph } from '../lib/dag';
import { isKnownConditionPredicate } from '../lib/condition-registry';
import type { PermissionService } from '@/features/execution/services/permission.service';
import type { PlanRequest } from '../lib/plan-request';

/**
 * The Execution Planner (spec: "converts natural language intent into
 * executable steps... Planner only produces plans. No execution occurs.").
 * The LLM proposes WHICH tools + params via the `<<ACTION:...>>` marker
 * convention (see `intent-detection.service.ts`); this service is the
 * deterministic layer that validates, structures, and hashes what it
 * proposed — the approval card's content comes from here, never from raw
 * LLM text, mirroring Phase 5's citation-validation posture. See
 * docs/planner.md.
 */

export interface BuiltPlan {
  plan: ExecutionPlanData;
  requiredRole: Role;
}

function containsUnresolvedReference(params: Record<string, unknown>): boolean {
  return Object.values(params).some((value) => typeof value === 'string' && value.trimStart().startsWith('$steps.'));
}

export class PlannerService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly validation: ValidationService,
    private readonly permission: PermissionService,
  ) {}

  async buildPlan(ctx: ToolContext, request: PlanRequest): Promise<BuiltPlan> {
    const stepDefs = this.expandRequest(request);
    validatePlanSteps(stepDefs);
    this.validateConditionPredicates(stepDefs);

    const tools = this.resolveTools(stepDefs);
    await this.validateSteps(ctx, stepDefs, tools);

    const graph = computeLayers(stepDefs);
    const estimatedTimeMs = await this.estimateTotal(ctx, stepDefs, tools);
    const requiredRole = this.permission.requiredRoleForTools(tools);
    const rollbackStrategy = this.computeRollbackStrategy(tools);
    const summary = this.buildSummary(request, stepDefs, tools);
    const planHash = this.computeHash(stepDefs);

    const plan = await createExecutionPlan({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      createdById: ctx.userId,
      summary,
      steps: stepDefs as unknown as Prisma.InputJsonValue,
      graph: graph as unknown as Prisma.InputJsonValue,
      planHash,
      estimatedTimeMs,
      rollbackStrategy,
    });

    return { plan, requiredRole };
  }

  /** Recomputes the hash of `steps` the same way `buildPlan` did — `ExecutionService` compares this against the stored `planHash` right before executing, and hard-fails on a mismatch rather than running a possibly-tampered plan. */
  hashSteps(steps: ExecutionStepDefinition[]): string {
    return this.computeHash(steps);
  }

  /**
   * `create_project` alone expands into the IF-EXISTS/ELSE two-step
   * conditional pair (`update_project` if a project with that title
   * already exists, `create_project` if not) — see docs/planner.md for why
   * this is deterministic, code-driven structuring rather than something
   * the LLM has to orchestrate itself.
   */
  private expandRequest(request: PlanRequest): ExecutionStepDefinition[] {
    if (request.kind === 'compound') {
      return request.steps.map((step) => ({
        key: step.key,
        toolKey: step.toolKey,
        version: step.version ?? '1',
        params: step.params,
        dependsOn: step.dependsOn ?? [],
        retry: step.retry,
      }));
    }

    if (request.toolKey === 'create_project') {
      const title = typeof request.params.title === 'string' ? request.params.title : '';
      if (!title) throw new ValidationError('A project title is required.');

      return [
        {
          key: 'update_existing',
          toolKey: 'update_project',
          version: '1',
          params: {
            lookupTitle: title,
            description: request.params.description,
            status: request.params.status,
            priority: request.params.priority,
          },
          dependsOn: [],
          condition: { predicate: 'project_exists_by_title', args: { title } },
        },
        {
          key: 'create_new',
          toolKey: 'create_project',
          version: request.version ?? '1',
          params: request.params,
          dependsOn: [],
          condition: { predicate: 'project_exists_by_title', args: { title }, negate: true },
        },
      ];
    }

    return [{ key: 'step_0', toolKey: request.toolKey, version: request.version ?? '1', params: request.params, dependsOn: [] }];
  }

  private validateConditionPredicates(steps: ExecutionStepDefinition[]): void {
    for (const step of steps) {
      if (step.condition && !isKnownConditionPredicate(step.condition.predicate)) {
        throw new ValidationError(`Unknown condition predicate: "${step.condition.predicate}".`);
      }
    }
  }

  private resolveTools(steps: ExecutionStepDefinition[]): AnyToolDefinition[] {
    return steps.map((step) => {
      const tool = this.registry.get(step.toolKey, step.version);
      if (!tool) throw new ValidationError(`Unknown tool "${step.toolKey}@${step.version}".`);
      return tool;
    });
  }

  /**
   * Schema-shape validation runs for every step immediately (satisfies the
   * lifecycle's "Parameter Validation" stage happening before Preview/
   * Approval). Full business `validate()` also runs immediately for steps
   * whose params are fully known now; steps referencing `$steps.*` output
   * from an upstream step (only possible in compound plans) can't be
   * business-validated until that value actually exists, so it's deferred
   * to `ExecutionService`'s mandatory pre-execution check for that step —
   * never skipped, just correctly timed.
   */
  private async validateSteps(ctx: ToolContext, steps: ExecutionStepDefinition[], tools: AnyToolDefinition[]): Promise<void> {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]!;
      const tool = tools[index]!;

      const schemaResult = await this.validation.validateParams(tool, step.params);
      if (!schemaResult.valid) {
        throw new ValidationError(`Step "${step.key}" has invalid parameters: ${schemaResult.errors.join('; ')}`);
      }

      if (!containsUnresolvedReference(step.params)) {
        const businessResult = await this.validation.validateStep(ctx, tool, step.params);
        if (!businessResult.valid) {
          throw new ValidationError(`Step "${step.key}" failed validation: ${businessResult.errors.join('; ')}`);
        }
      }
    }
  }

  private async estimateTotal(ctx: ToolContext, steps: ExecutionStepDefinition[], tools: AnyToolDefinition[]): Promise<number> {
    let total = 0;
    for (let index = 0; index < steps.length; index += 1) {
      total += await tools[index]!.estimate(ctx, steps[index]!.params);
    }
    return total;
  }

  private computeRollbackStrategy(tools: AnyToolDefinition[]): RollbackSupport {
    if (tools.some((tool) => tool.rollbackSupport === 'NOT_SUPPORTED')) return 'NOT_SUPPORTED';
    if (tools.some((tool) => tool.rollbackSupport === 'MANUAL')) return 'MANUAL';
    return 'AUTOMATIC';
  }

  private buildSummary(request: PlanRequest, steps: ExecutionStepDefinition[], tools: AnyToolDefinition[]): string {
    if (request.kind === 'compound' && request.summary) return request.summary;
    return steps.map((step, index) => tools[index]!.describe(step.params)).join('; then ');
  }

  private computeHash(steps: ExecutionStepDefinition[]): string {
    const canonical = steps.map((step) => ({
      key: step.key,
      toolKey: step.toolKey,
      version: step.version,
      params: step.params,
      dependsOn: [...step.dependsOn].sort(),
      condition: step.condition ?? null,
      retry: step.retry ?? null,
    }));
    return hashContent(JSON.stringify(canonical));
  }
}

export type { PlanGraph };
