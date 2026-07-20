import { requireRole } from '@bond-os/auth';
import {
  createConversation,
  createMessage,
  getConversationById,
  getOrganizationById,
  logAiRequest,
  touchConversation,
  type Prisma,
} from '@bond-os/database';
import { NotFoundError, ROLES, ValidationError, type SendBondMessageInput } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';
import type { ChatMessage } from '@bond-os/ai';

import { getAIProviderById } from '@/features/ai/services/ai-provider.service';
import { countTokensService } from '@/features/ai/services/ai.service';
import { buildPrompt } from '@/features/ai/services/prompt-builder.service';
import { buildActionInstructions, buildToolInstructions, NO_MORE_TOOLS_NOTICE } from '@/features/agents/services/agent-pipeline.service';
import type { PlanRequest } from '@/features/planner/lib/plan-request';
import { containsActionMarker, parseActionCall } from '@/features/planner/services/intent-detection.service';
import { proposeAction } from '@/features/planner/services/plan-proposal.service';
import { buildContext } from '@/features/retrieval/services/context-builder.service';
import type { ToolContext } from '@/features/tools/lib/tool-definition';

import { resolveEffectiveAiConfigService } from './ai-settings.service';
import { assertConversationAccess } from './conversation.service';
import { getConversationMemoryFacts, getRecentConversationHistory } from './conversation-memory.service';
import { validateCitations } from './citation-validation.service';
import { rewriteQuery } from './query-rewrite.service';
import { generateSuggestedQuestions } from './suggested-questions.service';
import { executeToolCall, parseToolCall, TOOL_NAMES } from './tool-calling.service';
import type { BondStreamEvent } from '../lib/stream-events';

/**
 * The RAG Pipeline (spec §3): User Question -> Query Rewrite -> Hybrid
 * Search -> Knowledge Graph Expansion -> Context Builder -> Prompt Builder
 * -> LLM -> Streaming Response -> Citations. "No shortcuts. Never bypass
 * retrieval." — every branch below runs through `buildContext` (which
 * itself calls `retrieve()`/`hybridSearch` and does KG expansion
 * internally, see context-builder.service.ts), there is no code path that
 * calls the AI provider without first assembling context from it.
 *
 * An async generator so `/api/bond/chat` can turn each yielded
 * `BondStreamEvent` directly into an SSE frame via `streaming-handler.ts`.
 */

/**
 * Builds and persists a write plan, requests approval, and persists the
 * deterministic ASSISTANT message describing it — content built entirely
 * from the plan's own validated steps + tool registry metadata (via the
 * shared `proposeAction`, also used by the standalone `POST
 * /api/execution/plan` route so both callers describe a plan identically),
 * never from the model's raw marker text — mirroring how citations are
 * validated against real retrieved data rather than trusted from LLM
 * output. Errors (e.g. `ValidationError` from bad params) propagate
 * naturally — the caller doesn't catch them, they surface through the same
 * SSE `error` path as any other pipeline failure.
 */
async function proposeWriteAction(
  ctx: ToolContext & { conversationId: string },
  request: PlanRequest,
): Promise<Extract<BondStreamEvent, { type: 'action_proposed' }>> {
  const { plan, requiredRole, steps, expiresAt } = await proposeAction(ctx, request);

  const contentLines = [
    `I'd like to: ${plan.summary}`,
    ...steps.map((step) => `- ${step.summary}`),
    `This requires ${requiredRole} approval and takes about ${(plan.estimatedTimeMs / 1000).toFixed(1)}s. Approve to proceed, or tell me if you'd like changes.`,
  ];

  // Everything `MessageBubble`'s `ApprovalCard` needs to re-render this
  // proposal after a page reload (`parseActionProposal` in
  // `message-bubble.tsx` reads this back) — not just `{ planId, status }`,
  // so a returning page load doesn't have to re-derive step summaries from
  // the tool registry (a tool could've been unregistered since).
  const message = await createMessage({
    conversationId: ctx.conversationId,
    organizationId: ctx.organizationId,
    role: 'ASSISTANT',
    content: contentLines.join('\n'),
    metadata: {
      planId: plan.id,
      status: 'AWAITING_APPROVAL',
      summary: plan.summary,
      steps,
      requiredRole,
      estimatedTimeMs: plan.estimatedTimeMs,
      rollbackStrategy: plan.rollbackStrategy,
      expiresAt: expiresAt.toISOString(),
    } as unknown as Prisma.InputJsonValue,
  });

  return {
    type: 'action_proposed',
    conversationId: ctx.conversationId,
    messageId: message.id,
    planId: plan.id,
    summary: plan.summary,
    steps,
    requiredRole,
    estimatedTimeMs: plan.estimatedTimeMs,
    rollbackStrategy: plan.rollbackStrategy,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function* runBondChatPipeline(
  organizationId: string,
  userId: string,
  input: SendBondMessageInput,
): AsyncGenerator<BondStreamEvent> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  const start = Date.now();

  let conversationId = input.conversationId;
  if (conversationId) {
    const existing = await getConversationById(conversationId, organizationId);
    if (!existing) throw new NotFoundError('Conversation not found.');
    await assertConversationAccess(existing, userId, membership.role, 'collaborate');
  } else {
    const created = await createConversation({
      organizationId,
      createdById: userId,
      title: input.content.slice(0, 80),
    });
    conversationId = created.id;
  }

  const organization = await getOrganizationById(organizationId);
  if (!organization) throw new NotFoundError('Organization not found.');

  const config = await resolveEffectiveAiConfigService(organizationId, input.model);
  const provider = getAIProviderById(config.providerId);

  await createMessage({ conversationId, organizationId, userId, role: 'USER', content: input.content });

  yield { type: 'status', stage: 'retrieving' };

  const history = await getRecentConversationHistory(organizationId, conversationId, 10);
  const memoryFacts = await getConversationMemoryFacts(organizationId, conversationId);
  const rewrittenQuery = rewriteQuery(input.content, history);

  const context = await buildContext(organizationId, rewrittenQuery, config.contextWindow);
  const built = buildPrompt(
    context,
    context.rawResults,
    { id: organization.id, name: organization.name },
    config.contextWindow,
    { conversationHistory: history, memoryFacts },
  );

  let messages: ChatMessage[] = [...built.messages];
  const maxToolCalls = getEnv().BOND_MAX_TOOL_CALLS;
  let toolCallsUsed = 0;

  if (maxToolCalls > 0) {
    messages = [
      messages[0]!,
      { role: 'system', content: buildToolInstructions(TOOL_NAMES) },
      { role: 'system', content: buildActionInstructions() },
      ...messages.slice(1),
    ];

    while (toolCallsUsed < maxToolCalls) {
      yield { type: 'status', stage: 'planning', detail: { attempt: toolCallsUsed + 1 } };

      const plan = await provider.generate({
        model: config.model,
        messages,
        temperature: 0,
        maxTokens: config.maxTokens,
      });

      // Action markers take precedence over (and are mutually exclusive
      // with) read-tool markers each planning iteration — a response
      // containing both is malformed, matching `parseToolCall`'s own
      // "malformed -> not a call" posture, so it falls through to the
      // no-tool-call `break` below rather than acting on either.
      const hasAction = containsActionMarker(plan.content);
      const toolCall = hasAction ? null : parseToolCall(plan.content);

      if (hasAction) {
        const actionRequest = parseActionCall(plan.content);
        if (actionRequest) {
          const proposedEvent = await proposeWriteAction({ organizationId, userId, conversationId }, actionRequest);
          yield proposedEvent;

          await logAiRequest({
            organizationId,
            userId,
            action: 'bond.action_proposed',
            provider: config.providerId,
            metadata: { conversationId, planId: proposedEvent.planId, durationMs: Date.now() - start },
          });

          // The turn ends here — no final `stream()` call. The "content"
          // for this turn IS the deterministic plan summary already
          // persisted inside `proposeWriteAction`, not LLM-streamed text.
          return;
        }
        break;
      }

      if (!toolCall) break;

      yield { type: 'status', stage: 'tool_call', detail: { tool: toolCall.tool } };

      const toolResult = await executeToolCall(organizationId, toolCall, TOOL_NAMES);
      messages.push({ role: 'assistant', content: plan.content });
      messages.push({ role: 'user', content: `Tool result for ${toolCall.tool}:\n${toolResult}` });
      toolCallsUsed += 1;
    }

    if (toolCallsUsed >= maxToolCalls) {
      messages.push({ role: 'system', content: NO_MORE_TOOLS_NOTICE });
    }
  }

  yield { type: 'status', stage: 'generating' };

  let finalContent = '';
  for await (const chunk of provider.stream({
    model: config.model,
    messages,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    topP: config.topP,
  })) {
    finalContent += chunk;
    yield { type: 'token', text: chunk };
  }

  if (!finalContent.trim()) {
    throw new ValidationError('The AI provider returned an empty response.');
  }

  const citations = await validateCitations(organizationId, finalContent, built.citations);

  const promptTokens = countTokensService(messages.map((message) => message.content).join('\n'));
  const completionTokens = countTokensService(finalContent);
  const tokenUsage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };

  const assistantMessage = await createMessage({
    conversationId,
    organizationId,
    role: 'ASSISTANT',
    content: finalContent,
    citations: citations as unknown as Prisma.InputJsonValue,
    tokenUsage,
    model: config.model,
    metadata: { toolCallsUsed, durationMs: Date.now() - start },
  });

  await touchConversation(conversationId, organizationId);

  yield { type: 'citations', citations };
  yield { type: 'suggestions', questions: generateSuggestedQuestions(context) };
  yield {
    type: 'done',
    conversationId,
    messageId: assistantMessage.id,
    model: config.model,
    tokenUsage,
  };

  await logAiRequest({
    organizationId,
    userId,
    action: 'bond.chat',
    provider: config.providerId,
    metadata: { conversationId, toolCallsUsed, durationMs: Date.now() - start, truncated: built.truncated },
  });
}
