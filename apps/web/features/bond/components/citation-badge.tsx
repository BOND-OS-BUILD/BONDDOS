'use client';

import { FileText, Network } from 'lucide-react';

import { Badge, cn } from '@bond-os/ui';

import type { BondCitation } from '../lib/stream-events';

export interface CitationBadgeProps {
  citation: BondCitation;
  onClick: (citation: BondCitation) => void;
  className?: string;
}

/** Same [0,1] -> semantic-color mapping as `SourcePanel`'s confidence badge, kept local since it's a 3-line pure function. */
function confidenceColorClass(confidence: number): string {
  if (confidence >= 0.75) return 'text-success';
  if (confidence >= 0.5) return 'text-warning';
  return 'text-destructive';
}

function citationLabel(citation: BondCitation): string {
  if (citation.documentTitle) {
    return citation.page !== null ? `${citation.documentTitle} · p.${citation.page}` : citation.documentTitle;
  }
  if (citation.entityTitle) return citation.entityTitle;
  return citation.ref;
}

/**
 * Inline, clickable citation chip rendered next to an assistant answer
 * (spec §7) — a compact document/entity label + rounded confidence
 * percentage. Clicking it opens `SourcePanel` for the full detail; this
 * component owns no open/closed state itself, it just reports the click.
 */
export function CitationBadge({ citation, onClick, className }: CitationBadgeProps) {
  const Icon = citation.documentId ? FileText : Network;
  const confidencePct = Math.round(citation.confidence * 100);

  return (
    <button
      type="button"
      onClick={() => onClick(citation)}
      className={cn('inline-flex max-w-full align-middle', className)}
    >
      <Badge
        variant="secondary"
        className="max-w-full cursor-pointer gap-1 font-normal transition-colors hover:bg-secondary/70"
        title={`${citationLabel(citation)} — ${confidencePct}% confidence`}
      >
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{citationLabel(citation)}</span>
        <span className={cn('shrink-0 font-semibold', confidenceColorClass(citation.confidence))}>
          {confidencePct}%
        </span>
      </Badge>
    </button>
  );
}
