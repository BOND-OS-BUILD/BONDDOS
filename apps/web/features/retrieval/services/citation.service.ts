import { requireRole } from '@bond-os/auth';
import { prisma } from '@bond-os/database';
import { NotFoundError, ROLES } from '@bond-os/shared';

import type { HybridSearchResult } from './hybrid-search.service';

/**
 * Citation Engine (spec §7): every retrieved result carries a citation —
 * document/page/chunk/entity/confidence — "future AI responses will cite
 * these references." Pure formatting over what retrieval already returns;
 * `resolveCitationService` is the one part that hits the DB, for resolving
 * a bare `ref` string (as future AI output would emit) back to full detail.
 */

export interface Citation {
  /** Opaque, stable — the same `HybridSearchResult.key` shape (`${kind}:${id}`), what a future AI response would actually cite. */
  ref: string;
  documentId: string | null;
  documentTitle: string | null;
  page: number | null;
  chunkId: string | null;
  entityId: string | null;
  entityTitle: string | null;
  /** From `buildCitation`: the result's ranked relevance score, clamped to [0,1]. From `resolveCitationService`: always 1 — a direct lookup by ref has no "relevance," only "found." */
  confidence: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function buildCitation(result: HybridSearchResult): Citation {
  const id = result.key.slice(result.kind.length + 1);
  return {
    ref: result.key,
    documentId: result.knowledgeDocumentId,
    documentTitle: result.kind === 'ENTITY' ? result.title : null,
    page: null,
    chunkId: result.kind === 'CHUNK' ? id : null,
    entityId: result.kind === 'ENTITY' ? id : null,
    entityTitle: result.kind === 'ENTITY' ? result.title : null,
    confidence: clamp01(result.score),
  };
}

export function buildCitations(results: HybridSearchResult[]): Citation[] {
  return results.map(buildCitation);
}

/** `/api/retrieval/citations` — resolves a bare `ref` (`kind:id`) back to its full document/page/chunk/entity. */
export async function resolveCitationService(organizationId: string, ref: string): Promise<Citation> {
  await requireRole(organizationId, ROLES.MEMBER);

  const separatorIndex = ref.indexOf(':');
  const kind = separatorIndex === -1 ? '' : ref.slice(0, separatorIndex);
  const id = separatorIndex === -1 ? '' : ref.slice(separatorIndex + 1);
  if (!kind || !id) throw new NotFoundError('Invalid citation reference.');

  if (kind === 'CHUNK') {
    const chunk = await prisma.chunk.findFirst({
      where: { id, knowledgeDocument: { organizationId } },
      select: {
        id: true,
        pageNumber: true,
        knowledgeDocument: { select: { id: true, entity: { select: { id: true, title: true } } } },
      },
    });
    if (!chunk) throw new NotFoundError('Citation not found.');
    return {
      ref,
      documentId: chunk.knowledgeDocument.id,
      documentTitle: chunk.knowledgeDocument.entity.title,
      page: chunk.pageNumber,
      chunkId: chunk.id,
      entityId: chunk.knowledgeDocument.entity.id,
      entityTitle: chunk.knowledgeDocument.entity.title,
      confidence: 1,
    };
  }

  if (kind === 'ENTITY') {
    const entity = await prisma.entity.findFirst({ where: { id, organizationId }, select: { id: true, title: true } });
    if (!entity) throw new NotFoundError('Citation not found.');
    return {
      ref,
      documentId: null,
      documentTitle: null,
      page: null,
      chunkId: null,
      entityId: entity.id,
      entityTitle: entity.title,
      confidence: 1,
    };
  }

  if (kind === 'EMAIL') {
    const email = await prisma.email.findFirst({ where: { id, organizationId }, select: { id: true, subject: true } });
    if (!email) throw new NotFoundError('Citation not found.');
    return { ref, documentId: null, documentTitle: null, page: null, chunkId: null, entityId: null, entityTitle: email.subject, confidence: 1 };
  }

  if (kind === 'MEETING') {
    const meeting = await prisma.meeting.findFirst({ where: { id, organizationId }, select: { id: true, title: true } });
    if (!meeting) throw new NotFoundError('Citation not found.');
    return { ref, documentId: null, documentTitle: null, page: null, chunkId: null, entityId: null, entityTitle: meeting.title, confidence: 1 };
  }

  throw new NotFoundError('Unknown citation kind.');
}
