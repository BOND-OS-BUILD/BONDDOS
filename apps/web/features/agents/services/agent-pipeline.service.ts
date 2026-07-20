import { requireRole } from '@bond-os/auth';
import { appendAgentTimelineEvent, createMessage, getAgentByKey, logAiRequest, touchConversation, type Prisma } from '@bond-os/database';
import { ForbiddenError, ROLES, ValidationError, roleSatisfies } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';
import type { ChatMessage } from '@bond-os/ai';

import { getAIProviderById } from '@/features/ai/services/ai-provider.service';
import { countTokensService } from '@/features/ai/services/ai.service';
import { buildPrompt } from '@/features/ai/services/prompt-builder.service';
import { resolveEffectiveAiConfigService } from '@/features/bond/services/ai-settings.service';
import { getConversationMemoryFacts } from '@/features/bond/services/conversation-memory.service';
import { generateSuggestedQuestions } from '@/features/bond/services/suggested-questions.service';
import { validateCitations } from '@/features/bond/services/citation-validation.service';
import { rewriteQuery } from '@/features/bond/services/query-rewrite.service';
import { executeToolCall, parseToolCall, TOOL_NAMES, type ToolName } from '@/features/bond/services/tool-calling.service';
import { getToolRegistryService } from '@/features/execution/lib/container';
import { containsActionMarker, parseActionCall } from '@/features/planner/services/intent-detection.service';
import { proposeAction } from '@/features/planner/services/plan-proposal.service';
import { buildContext } from '@/features/retrieval/services/context-builder.service';

import type { AgentContext, AgentDefinition, AgentDescriptor } from '../lib/agent-definition';
import type { AgentStreamEvent } from '../lib/agent-message';
import { enterDelegation, type DelegationBudget } from '../lib/delegation-budget';

/**
 * The shared reasoning engine (Phase 7) — `BaseAgent.think()`/`delegate()`/
 * `handoff()`/`summarize()` are thin calls into the functions here. This is
 * where the retrieve -> prompt -> tool/action/delegate dispatch -> stream
 * loop actually lives, generalized from (and, in the next build step,
 * reused BY) `apps/web/features/bond/services/rag-pipeline.service.ts` —
 * neither pipeline wraps the other; both call the same primitives, so
 * Mr. Bond's proven, externally-consumed event contract never becomes
 * structurally dependent on this newer, higher-surface-area code. See
 * docs/agents.md, docs/delegation.md.
 */

export const NO_MORE_TOOLS_NOTICE = 'No more tool calls are available. Answer now using only the information already gathered.';

const TOOL_ARG_HINTS: Record<ToolName, string> = {
  search: 'search{"query"}',
  graph: 'graph{"entityId"}',
  timeline: 'timeline{"entityId"}',
  documents: 'documents{"documentId"}',
  projects: 'projects{"query"}',
  meetings: 'meetings{"query"}',
  customers: 'customers{"query"}',
  emails: 'emails{"query"}',
  analytics: 'analytics{}',
};

/**
 * Shared with `rag-pipeline.service.ts` (extracted, not duplicated) — given
 * the full `TOOL_NAMES` set this reproduces Bond's original hardcoded
 * `TOOL_INSTRUCTIONS` text verbatim; a specialist agent's narrower
 * `supportedTools` just yields a shorter hint list, the real per-agent
 * boundary being `executeToolCall`'s `allowedTools` check, not this prompt.
 */
export function buildToolInstructions(allowedTools: readonly ToolName[]): string {
  if (allowedTools.length === 0) return 'You have no read tools available for this turn.';
  const hints = allowedTools.map((name) => TOOL_ARG_HINTS[name]).join(', ');
  return [
    'You may call one read-only tool per turn if you need more information before answering.',
    'To do so, reply with ONLY a single line in this exact form: <<TOOL:name>>{"arg":"value"}',
    `Available tools: ${hints}.`,
    'Do not call a tool if the Context above already answers the question.',
    'When you have enough information, answer in prose, citing sources with their [ref] markers exactly as given.',
  ].join(' ');
}

/**
 * Shared with `rag-pipeline.service.ts` (extracted, not duplicated) — Tool
 * Discovery (Phase 6 spec: "AI must never hardcode tool names"), lists the
 * live write-tool registry rather than a fixed string. Deliberately not
 * scoped to a per-agent subset: `PlannerService` already validates a
 * proposed plan's steps against the live registry regardless of which
 * agent proposed it, matching how any agent may propose a write in its
 * domain even though `supportedTools` (read-only) is narrower.
 */
export function buildActionInstructions(): string {
  const tools = getToolRegistryService().list();
  const toolLines = tools.map((tool) => `${tool.toolKey}{...} — ${tool.description}`).join(' ');

  return [
    'If the user is asking you to CREATE, UPDATE, or ARCHIVE something (not just asking a question), you may propose an action instead of answering directly.',
    'This NEVER executes anything by itself — the user must explicitly approve it afterward.',
    'To propose a single action, reply with ONLY one line: <<ACTION:tool_key>>{"param":"value"}',
    `Available action tools: ${toolLines}`,
    'For a multi-step request (e.g. "create a project with tasks and a kickoff meeting"), reply with ONLY one line: <<ACTION:plan>>{"summary":"...","steps":[{"key":"s1","toolKey":"create_project","params":{...},"dependsOn":[]},{"key":"s2","toolKey":"create_task","params":{"projectId":"$steps.s1.output.id","title":"..."},"dependsOn":["s1"]}]}',
    'Do not propose an action for a question that only needs information — use a <<TOOL:...>> read for that instead.',
  ].join(' ');
}

function buildDelegateInstructions(availableAgents: AgentDescriptor[]): string {
  if (availableAgents.length === 0) return '';
  const list = availableAgents.map((agent) => `${agent.agentKey} (${agent.description})`).join('; ');
  return [
    'If another specialist is better suited to this request, you may consult or fully hand off to them.',
    `Available agents: ${list}.`,
    'To consult one and keep answering yourself, reply with ONLY one line: <<DELEGATE:agent_key>>{"question":"...","handoff":false}',
    'To hand off the entire request (their answer becomes the final response), use the same form with "handoff":true.',
    'Only one action/tool/delegate marker per turn — never combine them.',
  ].join(' ');
}

/**
 * Best-effort — records the `AgentTimelineEvent` the Delegation Graph UI
 * queries (`eventType=DELEGATION`). Resolves `agentId` via the plain
 * `getAgentByKey` REPOSITORY function (not the registry/container), so this
 * carries no circular-import risk the way importing `agents/registry.ts`
 * here would. Silently no-ops if the agent hasn't been synced to the
 * database yet — this is observability, never a gate on the delegation
 * itself succeeding.
 */
async function recordDelegationEvent(
  ctx: AgentContext,
  from: AgentDescriptor,
  to: AgentDescriptor,
  handoff: boolean,
): Promise<void> {
  const fromAgent = await getAgentByKey(from.agentKey, from.version);
  if (!fromAgent) return;
  await appendAgentTimelineEvent({
    organizationId: ctx.organizationId,
    agentId: fromAgent.id,
    conversationId: ctx.conversationId,
    eventType: 'DELEGATION',
    metadata: { toAgentKey: to.agentKey, toAgentDisplayName: to.displayName, handoff },
  });
}

interface ParsedDelegateCall {
  agentKey: string;
  question: string;
  handoff: boolean;
}

const DELEGATE_MARKER = /<<DELEGATE:([a-zA-Z0-9_]+)>>\s*(\{[^\n]*\})/;

function containsDelegateMarker(text: string): boolean {
  return DELEGATE_MARKER.test(text);
}

function parseDelegateCall(text: string): ParsedDelegateCall | null {
  const match = DELEGATE_MARKER.exec(text);
  if (!match) return null;
  const [, agentKey, payloadJson] = match;
  try {
    const payload = JSON.parse(payloadJson!) as Record<string, unknown>;
    if (typeof payload.question !== 'string') return null;
    return { agentKey: agentKey!, question: payload.question, handoff: payload.handoff === true };
  } catch {
    return null;
  }
}

export interface ThinkOptions {
  /** `false` for a `delegate()` consult sub-call — suppresses persisting a `Message`/touching the conversation/emitting citations-suggestions-done, since a consult's answer is an internal detail the caller incorporates, not a new visible conversation turn. `handoff()` and top-level calls always persist. */
  persist: boolean;
}

export async function* runThinkLoop(
  agent: AgentDefinition,
  ctx: AgentContext,
  input: string,
  history: ChatMessage[],
  budget: DelegationBudget,
  options: ThinkOptions = { persist: true },
): AsyncGenerator<AgentStreamEvent> {
  await requireRole(ctx.organizationId, ROLES.MEMBER);
  const start = Date.now();
  const agentKey = agent.descriptor.agentKey;
  const descriptor = agent.descriptor;

  // The single choke point every entry point (top-level chat, delegate,
  // handoff, a Goal's SUGGEST phase) funnels through — `ctx.role` is the
  // caller's real membership role, resolved once at the top of the turn and
  // threaded unchanged through every recursive call, so a target agent with
  // a stricter `minimumRole` than the chain's root agent is enforced on
  // every hop, not just the first.
  if (!roleSatisfies(ctx.role, descriptor.minimumRole)) {
    throw new ForbiddenError(`${descriptor.displayName} requires the ${descriptor.minimumRole} role or higher.`);
  }

  const config = await resolveEffectiveAiConfigService(ctx.organizationId, descriptor.model);
  const provider = getAIProviderById(config.providerId);
  const tokenBudget = descriptor.maxContext ?? config.contextWindow;

  yield { type: 'status', agentKey, stage: 'retrieving' };

  const rewrittenInput = rewriteQuery(input, history);
  const memoryFacts = options.persist && ctx.conversationId
    ? await getConversationMemoryFacts(ctx.organizationId, ctx.conversationId)
    : [];

  const context = await buildContext(ctx.organizationId, rewrittenInput, tokenBudget);
  const built = buildPrompt(context, context.rawResults, ctx.organization, tokenBudget, {
    conversationHistory: history,
    memoryFacts,
  });

  let messages: ChatMessage[] = [
    { role: 'system', content: `You are ${descriptor.displayName}. ${descriptor.description}` },
    ...built.messages,
  ];

  const maxToolCalls = getEnv().BOND_MAX_TOOL_CALLS;
  let toolCallsUsed = 0;

  if (maxToolCalls > 0) {
    messages = [
      messages[0]!,
      { role: 'system', content: buildToolInstructions(descriptor.supportedTools) },
      { role: 'system', content: buildActionInstructions() },
      { role: 'system', content: buildDelegateInstructions(ctx.availableAgents) },
      ...messages.slice(1),
    ];

    while (toolCallsUsed < maxToolCalls && budget.toolCallsRemaining > 0) {
      yield { type: 'status', agentKey, stage: 'planning', detail: { attempt: toolCallsUsed + 1 } };

      const plan = await provider.generate({ model: config.model, messages, temperature: 0, maxTokens: config.maxTokens });

      const markerKinds = [containsActionMarker(plan.content), containsDelegateMarker(plan.content), parseToolCall(plan.content) !== null].filter(Boolean).length;
      if (markerKinds > 1) break; // more than one marker type present — malformed, fall through to a final prose answer

      if (containsActionMarker(plan.content)) {
        const actionRequest = parseActionCall(plan.content);
        if (!actionRequest) break;
        if (!ctx.conversationId) throw new ValidationError('An action was proposed but this turn has no conversation to attach it to.');

        const proposed = await proposeAction(
          { organizationId: ctx.organizationId, userId: ctx.userId, conversationId: ctx.conversationId },
          actionRequest,
        );

        const contentLines = [
          `I'd like to: ${proposed.plan.summary}`,
          ...proposed.steps.map((step) => `- ${step.summary}`),
          `This requires ${proposed.requiredRole} approval and takes about ${(proposed.plan.estimatedTimeMs / 1000).toFixed(1)}s.`,
        ];
        const message = await createMessage({
          conversationId: ctx.conversationId,
          organizationId: ctx.organizationId,
          role: 'ASSISTANT',
          content: contentLines.join('\n'),
          metadata: { agentKey, planId: proposed.plan.id, status: 'AWAITING_APPROVAL' },
        });

        yield {
          type: 'action_proposed',
          agentKey,
          conversationId: ctx.conversationId,
          messageId: message.id,
          planId: proposed.plan.id,
          summary: proposed.plan.summary,
          steps: proposed.steps,
          requiredRole: proposed.requiredRole,
          estimatedTimeMs: proposed.plan.estimatedTimeMs,
          rollbackStrategy: proposed.plan.rollbackStrategy,
          expiresAt: proposed.expiresAt.toISOString(),
        };
        return;
      }

      if (containsDelegateMarker(plan.content)) {
        const delegateCall = parseDelegateCall(plan.content);
        if (!delegateCall) break;

        // Resolve existence BEFORE enterDelegation — a hallucinated/
        // nonexistent agent key must not consume real delegation-depth
        // budget (enterDelegation mutates visitedAgentKeys/depth on
        // success; checking existence first keeps that mutation reserved
        // for genuine hops).
        const targetAgent = budget.resolveAgent(delegateCall.agentKey);
        if (!targetAgent) {
          messages.push({ role: 'assistant', content: plan.content });
          messages.push({ role: 'user', content: `Delegation failed: Unknown agent "${delegateCall.agentKey}". Answer using what you already know instead.` });
          toolCallsUsed += 1;
          budget.toolCallsRemaining -= 1;
          continue;
        }

        try {
          enterDelegation(budget, delegateCall.agentKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Delegation failed.';
          messages.push({ role: 'assistant', content: plan.content });
          messages.push({ role: 'user', content: `Delegation failed: ${message}. Answer using what you already know instead.` });
          toolCallsUsed += 1;
          budget.toolCallsRemaining -= 1;
          continue;
        }

        if (delegateCall.handoff) {
          yield { type: 'status', agentKey, stage: 'delegating', detail: { to: delegateCall.agentKey, handoff: true } };
          await recordDelegationEvent(ctx, descriptor, targetAgent.descriptor, true);
          yield* runThinkLoop(targetAgent, ctx, delegateCall.question, history, budget, options);
          return;
        }

        yield { type: 'status', agentKey, stage: 'delegating', detail: { to: delegateCall.agentKey, handoff: false } };
        await recordDelegationEvent(ctx, descriptor, targetAgent.descriptor, false);
        let consultAnswer = '';
        for await (const event of runThinkLoop(targetAgent, ctx, delegateCall.question, [], budget, { persist: false })) {
          if (event.type === 'token') consultAnswer += event.text;
        }
        messages.push({ role: 'assistant', content: plan.content });
        messages.push({ role: 'user', content: `${targetAgent.descriptor.displayName}'s answer:\n${consultAnswer || '(no answer)'}` });
        toolCallsUsed += 1;
        budget.toolCallsRemaining -= 1;
        continue;
      }

      const toolCall = parseToolCall(plan.content);
      if (!toolCall) break;

      yield { type: 'status', agentKey, stage: 'tool_call', detail: { tool: toolCall.tool } };
      const toolResult = await executeToolCall(ctx.organizationId, toolCall, descriptor.supportedTools);
      messages.push({ role: 'assistant', content: plan.content });
      messages.push({ role: 'user', content: `Tool result for ${toolCall.tool}:\n${toolResult}` });
      toolCallsUsed += 1;
      budget.toolCallsRemaining -= 1;
    }

    if (toolCallsUsed >= maxToolCalls || budget.toolCallsRemaining <= 0) {
      messages.push({ role: 'system', content: NO_MORE_TOOLS_NOTICE });
    }
  }

  yield { type: 'status', agentKey, stage: 'generating' };

  let finalContent = '';
  for await (const chunk of provider.stream({ model: config.model, messages, temperature: config.temperature, maxTokens: config.maxTokens, topP: config.topP })) {
    finalContent += chunk;
    yield { type: 'token', agentKey, text: chunk };
  }

  if (!finalContent.trim()) {
    throw new ValidationError('The AI provider returned an empty response.');
  }

  if (!options.persist) {
    // A delegate() consult — the caller already accumulated `token` events
    // above. No Message, no citations/suggestions/done for an answer the
    // user never sees as its own turn.
    return;
  }

  const citations = await validateCitations(ctx.organizationId, finalContent, built.citations);
  const promptTokens = countTokensService(messages.map((message) => message.content).join('\n'));
  const completionTokens = countTokensService(finalContent);
  const tokenUsage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };

  let messageId = '';
  if (ctx.conversationId) {
    const assistantMessage = await createMessage({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      role: 'ASSISTANT',
      content: finalContent,
      citations: citations as unknown as Prisma.InputJsonValue,
      tokenUsage,
      model: config.model,
      metadata: { agentKey, toolCallsUsed, durationMs: Date.now() - start },
    });
    messageId = assistantMessage.id;
    await touchConversation(ctx.conversationId, ctx.organizationId);
  }

  yield { type: 'citations', agentKey, citations };
  yield { type: 'suggestions', agentKey, questions: generateSuggestedQuestions(context) };
  yield {
    type: 'done',
    agentKey,
    conversationId: ctx.conversationId ?? '',
    messageId,
    model: config.model,
    tokenUsage,
  };

  await logAiRequest({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: 'agent.think',
    provider: config.providerId,
    metadata: { agentKey, conversationId: ctx.conversationId, toolCallsUsed, durationMs: Date.now() - start },
  });
}

/** `BaseAgent.delegate()` — drains the target's `think()` (persist:false) and returns the accumulated text. Used directly (not via marker) for chained Sequential/Consensus collaboration (plan design decision #3). */
export async function runDelegate(
  caller: AgentDefinition,
  ctx: AgentContext,
  targetAgentKey: string,
  question: string,
  budget: DelegationBudget,
): Promise<string> {
  enterDelegation(budget, targetAgentKey);
  const targetAgent = budget.resolveAgent(targetAgentKey);
  if (!targetAgent) throw new Error(`Unknown agent "${targetAgentKey}".`);

  await recordDelegationEvent(ctx, caller.descriptor, targetAgent.descriptor, false);

  let answer = '';
  for await (const event of runThinkLoop(targetAgent, ctx, question, [], budget, { persist: false })) {
    if (event.type === 'token') answer += event.text;
  }
  return answer;
}

/** `BaseAgent.handoff()` — the target's own `think()` events (persist:true) become the caller's remaining output directly. */
export async function* runHandoff(
  caller: AgentDefinition,
  ctx: AgentContext,
  targetAgentKey: string,
  question: string,
  history: ChatMessage[],
  budget: DelegationBudget,
): AsyncGenerator<AgentStreamEvent> {
  enterDelegation(budget, targetAgentKey);
  const targetAgent = budget.resolveAgent(targetAgentKey);
  if (!targetAgent) throw new Error(`Unknown agent "${targetAgentKey}".`);

  await recordDelegationEvent(ctx, caller.descriptor, targetAgent.descriptor, true);
  yield* runThinkLoop(targetAgent, ctx, question, history, budget, { persist: true });
}

/** A real LLM synthesis call reconciling multiple agents' answers (Consensus/Sequential/Parallel) — explicitly asked to surface disagreement, not silently favor whichever answered last. */
export async function runSummarize(ctx: AgentContext, pieces: Array<{ agentKey: string; content: string }>): Promise<string> {
  await requireRole(ctx.organizationId, ROLES.MEMBER);
  if (pieces.length === 0) return '';
  if (pieces.length === 1) return pieces[0]!.content;

  const config = await resolveEffectiveAiConfigService(ctx.organizationId);
  const provider = getAIProviderById(config.providerId);

  const sections = pieces.map((piece) => `--- ${piece.agentKey} ---\n${piece.content}`).join('\n\n');
  const result = await provider.generate({
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    messages: [
      {
        role: 'system',
        content:
          'Reconcile the following specialist answers into one coherent response. If they disagree or one flags a concern with another\'s assumptions, say so explicitly rather than silently picking one. Do not invent a confidence score.',
      },
      { role: 'user', content: sections },
    ],
  });

  return result.content;
}

export { TOOL_NAMES };
