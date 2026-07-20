import { ValidationError } from '@bond-os/shared';

import { retrieve } from '@/features/retrieval/services/retrieval.service';

import type { WorkflowStepHandler, WorkflowStepHandlerContext } from '../lib/step-handler';

/** SEARCH_KNOWLEDGE — the same hybrid-search primitive Bond's `search` read-tool and every retrieval-driven surface in this codebase already uses. Never bypasses retrieval, matching the RAG pipeline's own "no shortcuts" rule. */
export const searchKnowledgeHandler: WorkflowStepHandler = {
  stepType: 'SEARCH_KNOWLEDGE',
  async execute(ctx: WorkflowStepHandlerContext, params) {
    const query = params.query;
    if (typeof query !== 'string' || !query.trim()) throw new ValidationError('SEARCH_KNOWLEDGE: "query" is required.');
    const limit = typeof params.limit === 'number' ? params.limit : 10;

    const results = await retrieve(ctx.organizationId, query, { limit });

    return {
      kind: 'succeeded',
      output: { results: results.map((result) => ({ ref: result.key, title: result.title, snippet: result.snippet })) },
    };
  },
};
