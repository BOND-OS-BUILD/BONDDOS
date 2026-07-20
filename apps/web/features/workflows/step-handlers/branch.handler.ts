import type { WorkflowStepHandler } from '../lib/step-handler';

/**
 * BRANCH — a fork point in the visual builder, not a distinct runtime
 * behavior: the actual branching is two downstream steps at the same DAG
 * layer with complementary `condition`s (the IF-EXISTS/ELSE pattern
 * `dag.ts`/`condition-registry.ts` already established in Phase 6 —
 * `computeLayers` doesn't need to know branching exists, it just sees two
 * steps with identical `dependsOn`; the driver's generic per-step
 * `condition` check, not this handler, decides which one runs vs is
 * SKIPPED). This handler exists so BRANCH is a valid, registerable
 * `stepType` for the graph — it always succeeds immediately.
 */
export const branchHandler: WorkflowStepHandler = {
  stepType: 'BRANCH',
  async execute() {
    return { kind: 'succeeded', output: {} };
  },
};
