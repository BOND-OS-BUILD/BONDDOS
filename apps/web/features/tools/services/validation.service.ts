import type { AnyToolDefinition, ToolContext, ToolValidationResult } from '../lib/tool-definition';

/**
 * Wraps every tool's own `validate()` with the tool's declared Zod
 * `parameters` schema first — parameter shape/type errors are caught here,
 * deterministically, before a tool's own business-validation (e.g. does a
 * referenced record belong to this organization) ever runs. See
 * docs/tool-execution.md.
 */
export class ValidationService {
  async validateParams(tool: AnyToolDefinition, params: unknown): Promise<ToolValidationResult> {
    const { parameters } = tool.schema();
    const result = parameters.safeParse(params);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      };
    }
    return { valid: true, errors: [] };
  }

  async validateStep(ctx: ToolContext, tool: AnyToolDefinition, params: unknown): Promise<ToolValidationResult> {
    const schemaResult = await this.validateParams(tool, params);
    if (!schemaResult.valid) return schemaResult;

    const { parameters } = tool.schema();
    const parsed = parameters.parse(params);
    return tool.validate(ctx, parsed);
  }
}
