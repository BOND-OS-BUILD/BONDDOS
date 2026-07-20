'use client';

import * as React from 'react';

import { Badge, cn, Modal, ModalContent, ModalDescription, ModalHeader, ModalTitle, Skeleton } from '@bond-os/ui';

import type { BondCitation } from '../lib/stream-events';

export interface SourcePanelProps {
  /** `null` keeps the panel closed — a controlled component, same pattern as `MermaidBlock`'s caller-owned state. */
  citation: BondCitation | null;
  onClose: () => void;
}

interface DocumentChunkPreview {
  id: string;
  position: number;
  embedded: boolean;
  preview: string;
}

interface DocumentPreview {
  knowledgeDocumentId: string;
  title: string;
  chunkCount: number;
  embeddedChunkCount: number;
  chunks: DocumentChunkPreview[];
}

interface RelatedEntity {
  id: string;
  title: string;
  entityType: string;
}

interface TimelineItem {
  id: string;
  description: string;
  eventType: string;
  createdAt: string;
  entity: { title: string };
}

interface EntityPreview {
  id: string;
  title: string;
  description: string | null;
  relationships: {
    outgoing: Array<{ id: string; relationshipType: string; targetEntity: RelatedEntity }>;
    incoming: Array<{ id: string; relationshipType: string; sourceEntity: RelatedEntity }>;
  };
  timeline: { items: TimelineItem[] };
}

/** Same [0,1] -> semantic-color mapping as `CitationBadge`'s confidence badge. */
function confidenceColorClass(confidence: number): string {
  if (confidence >= 0.75) return 'text-success';
  if (confidence >= 0.5) return 'text-warning';
  return 'text-destructive';
}

/**
 * The Source Viewer slide-over (spec §7) — opened by clicking a
 * `CitationBadge` in an assistant's answer. Fetches document preview
 * (`/api/retrieval/document`, chunk-level, highlighting the cited chunk) or
 * entity detail (`/api/retrieval/entity`, related entities + timeline),
 * whichever the citation actually points to — both existing Phase 4 routes,
 * reused unchanged.
 */
export function SourcePanel({ citation, onClose }: SourcePanelProps) {
  const [documentDetail, setDocumentDetail] = React.useState<DocumentPreview | null>(null);
  const [entityDetail, setEntityDetail] = React.useState<EntityPreview | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setDocumentDetail(null);
    setEntityDetail(null);

    if (!citation) return;

    const url = citation.documentId
      ? `/api/retrieval/document?id=${encodeURIComponent(citation.documentId)}`
      : citation.entityId
        ? `/api/retrieval/entity?id=${encodeURIComponent(citation.entityId)}`
        : null;
    if (!url) return;

    let cancelled = false;
    setLoading(true);

    fetch(url)
      .then((response) => response.json())
      .then((result: { success: boolean; data?: unknown }) => {
        if (cancelled || !result.success) return;
        if (citation.documentId) setDocumentDetail(result.data as DocumentPreview);
        else setEntityDetail(result.data as EntityPreview);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [citation]);

  const title = citation?.documentTitle ?? citation?.entityTitle ?? 'Source';
  const confidencePct = citation ? Math.round(citation.confidence * 100) : 0;

  return (
    <Modal open={citation !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <ModalContent
        className={cn(
          'fixed inset-y-0 left-auto right-0 top-0 h-full w-full max-w-md translate-x-0 translate-y-0',
          'gap-0 overflow-y-auto rounded-none border-l p-0',
          'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        )}
      >
        {citation ? (
          <div className="flex h-full flex-col">
            <ModalHeader className="border-b border-border p-4 text-left">
              <ModalTitle className="truncate pr-6">{title}</ModalTitle>
              <ModalDescription className="flex flex-wrap items-center gap-2">
                {citation.page !== null ? <span>Page {citation.page}</span> : null}
                <Badge variant="secondary" className={cn('font-semibold', confidenceColorClass(citation.confidence))}>
                  {confidencePct}% confidence
                </Badge>
              </ModalDescription>
            </ModalHeader>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : documentDetail ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {documentDetail.embeddedChunkCount} of {documentDetail.chunkCount} chunks indexed
                  </p>
                  {documentDetail.chunks.map((chunk) => (
                    <div
                      key={chunk.id}
                      className={cn(
                        'rounded-md border border-border p-3 text-sm',
                        citation.chunkId === chunk.id && 'border-primary bg-accent',
                      )}
                    >
                      <p className="mb-1 text-xs text-muted-foreground">
                        Chunk {chunk.position + 1}
                        {chunk.embedded ? '' : ' (not indexed)'}
                        {citation.chunkId === chunk.id ? ' — cited' : ''}
                      </p>
                      <p className="whitespace-pre-wrap">{chunk.preview}</p>
                    </div>
                  ))}
                </div>
              ) : entityDetail ? (
                <div className="space-y-4">
                  {entityDetail.description ? <p className="text-sm">{entityDetail.description}</p> : null}

                  {entityDetail.relationships.outgoing.length > 0 || entityDetail.relationships.incoming.length > 0 ? (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Related entities</p>
                      <div className="flex flex-wrap gap-2">
                        {entityDetail.relationships.outgoing.map((edge) => (
                          <Badge key={edge.id} variant="secondary" title={edge.relationshipType} className="font-normal">
                            {edge.targetEntity.title}
                          </Badge>
                        ))}
                        {entityDetail.relationships.incoming.map((edge) => (
                          <Badge key={edge.id} variant="secondary" title={edge.relationshipType} className="font-normal">
                            {edge.sourceEntity.title}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {entityDetail.timeline.items.length > 0 ? (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Timeline</p>
                      <div className="space-y-2">
                        {entityDetail.timeline.items.slice(0, 10).map((event) => (
                          <div key={event.id} className="text-sm">
                            <span className="text-muted-foreground">{event.entity.title}</span> — {event.description}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No preview available for this source.</p>
              )}
            </div>
          </div>
        ) : null}
      </ModalContent>
    </Modal>
  );
}
