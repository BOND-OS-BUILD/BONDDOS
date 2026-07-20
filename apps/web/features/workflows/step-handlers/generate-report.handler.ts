import { ValidationError } from '@bond-os/shared';

import type { WorkflowStepHandler } from '../lib/step-handler';

interface ReportSectionParam {
  label: string;
  /** Already-resolved by the driver via `resolveStepParams` before this handler runs — a `$steps.<key>.output...` reference or a literal. */
  content: unknown;
}

/**
 * GENERATE_REPORT — deterministically assembles prior step outputs into a
 * structured report (Core Principles: "Deterministic execution" — no AI
 * call, no invented narrative). `sections[].content` values are plain
 * params, already resolved by the driver via `dag.ts`'s `resolveStepParams`
 * before this handler ever sees them, exactly like every other step's
 * params.
 */
export const generateReportHandler: WorkflowStepHandler = {
  stepType: 'GENERATE_REPORT',
  async execute(_ctx, params) {
    const title = params.title;
    const sections = params.sections;
    if (typeof title !== 'string' || !title) throw new ValidationError('GENERATE_REPORT: "title" is required.');
    if (!Array.isArray(sections)) throw new ValidationError('GENERATE_REPORT: "sections" must be an array.');

    const resolvedSections = sections.map((section, index): ReportSectionParam => {
      if (!section || typeof section !== 'object' || typeof (section as { label?: unknown }).label !== 'string') {
        throw new ValidationError(`GENERATE_REPORT: sections[${index}] must have a string "label".`);
      }
      const { label, content } = section as { label: string; content: unknown };
      return { label, content };
    });

    return {
      kind: 'succeeded',
      output: { title, generatedAt: new Date().toISOString(), sections: resolvedSections },
    };
  },
};
