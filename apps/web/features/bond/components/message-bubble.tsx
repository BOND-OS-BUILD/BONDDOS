import { ApprovalCard, type ApprovalCardStep } from '@/features/execution/components/approval-card';

import type { BondCitation, BondProposedStep } from '../lib/stream-events';
import { CitationBadge } from './citation-badge';
import { MarkdownMessage } from './markdown-message';

/**
 * The structured payload behind a proposed write plan (Phase 6) — the same
 * fields carried by the `action_proposed` SSE event (see
 * `stream-events.ts`), minus `type`/`conversationId`/`messageId` (redundant
 * once folded onto a `BondChatMessage`). Present on a message whenever
 * `Message.metadata` (persisted history) or the live stream marks it
 * `AWAITING_APPROVAL`.
 */
export interface BondActionProposal {
  planId: string;
  summary: string;
  steps: BondProposedStep[];
  requiredRole: string;
  estimatedTimeMs: number;
  rollbackStrategy: string;
  expiresAt: string;
}

/**
 * A single chat turn as rendered by `ChatThread` — decoupled from
 * `MessageItem` (`@bond-os/database`) so an optimistic, not-yet-persisted
 * USER/ASSISTANT message (no DB id yet) fits the same shape as one loaded
 * from `listMessagesService`. `actionProposal` is additive: only set when
 * this turn proposed a write, in which case `MessageBubble` renders an
 * `ApprovalCard` instead of markdown content.
 */
export interface BondChatMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  citations?: BondCitation[] | null;
  createdAt?: Date | string;
  actionProposal?: BondActionProposal | null;
}

/**
 * Narrows a persisted `Message.metadata` (`unknown` JSON) into a
 * `BondActionProposal`, or `null` if it isn't one — used by the
 * conversation page's server-side mapping from `MessageItem[]` (where
 * `rag-pipeline.service.ts`'s `proposeWriteAction` persisted the full
 * `action_proposed` payload onto `metadata`, not just `{ planId, status }`).
 * Never throws: malformed/legacy metadata just renders as a plain message.
 */
export function parseActionProposal(metadata: unknown): BondActionProposal | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const candidate = metadata as Record<string, unknown>;
  if (candidate.status !== 'AWAITING_APPROVAL') return null;
  if (typeof candidate.planId !== 'string') return null;
  if (typeof candidate.summary !== 'string') return null;
  if (!Array.isArray(candidate.steps)) return null;
  if (typeof candidate.requiredRole !== 'string') return null;
  if (typeof candidate.estimatedTimeMs !== 'number') return null;
  if (typeof candidate.rollbackStrategy !== 'string') return null;
  if (typeof candidate.expiresAt !== 'string') return null;

  const steps = candidate.steps.filter(
    (step): step is BondProposedStep =>
      typeof step === 'object' &&
      step !== null &&
      typeof (step as Record<string, unknown>).key === 'string' &&
      typeof (step as Record<string, unknown>).toolKey === 'string' &&
      typeof (step as Record<string, unknown>).displayName === 'string' &&
      typeof (step as Record<string, unknown>).summary === 'string',
  );
  if (steps.length !== candidate.steps.length) return null;

  return {
    planId: candidate.planId,
    summary: candidate.summary,
    steps,
    requiredRole: candidate.requiredRole,
    estimatedTimeMs: candidate.estimatedTimeMs,
    rollbackStrategy: candidate.rollbackStrategy,
    expiresAt: candidate.expiresAt,
  };
}

function toApprovalCardSteps(steps: BondProposedStep[]): ApprovalCardStep[] {
  return steps.map((step) => ({ key: step.key, toolKey: step.toolKey, displayName: step.displayName, summary: step.summary }));
}

export interface MessageBubbleProps {
  message: BondChatMessage;
  /** Opens the Source Panel for a citation — omitted while a message is still streaming (no panel target makes sense mid-answer). */
  onCitationClick?: (citation: BondCitation) => void;
}

/**
 * One chat turn — USER right-aligned as plain text, ASSISTANT left-aligned
 * under a "Mr. Bond" label with either markdown content + one clickable
 * `CitationBadge` per source (each opening `ChatThread`'s Source Panel), or
 * — when `message.actionProposal` is set — an `ApprovalCard` in place of
 * the markdown bubble, since its content is just the same plan restated as
 * prose.
 */
export function MessageBubble({ message, onCitationClick }: MessageBubbleProps) {
  if (message.role === 'USER') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  // Nothing generated yet for this turn — ChatThread's status indicator
  // ("Retrieving…" / "Thinking…" / …) fills this gap instead of an empty bubble.
  if (message.content.length === 0 && !message.actionProposal) {
    return null;
  }

  const citations = message.citations ?? [];

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1">
        <p className="text-xs font-semibold text-muted-foreground">Mr. Bond</p>
        {message.actionProposal ? (
          <ApprovalCard
            planId={message.actionProposal.planId}
            summary={message.actionProposal.summary}
            steps={toApprovalCardSteps(message.actionProposal.steps)}
            requiredRole={message.actionProposal.requiredRole}
            estimatedTimeMs={message.actionProposal.estimatedTimeMs}
            rollbackStrategy={message.actionProposal.rollbackStrategy}
            expiresAt={message.actionProposal.expiresAt}
          />
        ) : (
          <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm">
            <MarkdownMessage content={message.content} />
          </div>
        )}
        {citations.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {citations.map((citation) => (
              <CitationBadge key={citation.ref} citation={citation} onClick={() => onCitationClick?.(citation)} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
