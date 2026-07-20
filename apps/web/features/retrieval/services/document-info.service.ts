import { requireRole } from '@bond-os/auth';
import { getEmbeddingsBySourceIds, prisma } from '@bond-os/database';
import { NotFoundError, ROLES } from '@bond-os/shared';

/** `/api/retrieval/document` — a KnowledgeDocument's retrieval/embedding status: which chunks exist and which are actually embedded yet. */

export interface DocumentChunkInfo {
  id: string;
  position: number;
  embedded: boolean;
  preview: string;
}

export interface DocumentRetrievalInfo {
  knowledgeDocumentId: string;
  title: string;
  chunkCount: number;
  embeddedChunkCount: number;
  chunks: DocumentChunkInfo[];
}

export async function getDocumentRetrievalInfoService(
  organizationId: string,
  knowledgeDocumentId: string,
): Promise<DocumentRetrievalInfo> {
  await requireRole(organizationId, ROLES.MEMBER);

  const document = await prisma.knowledgeDocument.findFirst({
    where: { id: knowledgeDocumentId, organizationId },
    select: {
      entity: { select: { title: true } },
      chunks: { select: { id: true, position: true, content: true }, orderBy: { position: 'asc' } },
    },
  });
  if (!document) throw new NotFoundError('Document not found.');

  const chunkIds = document.chunks.map((chunk) => chunk.id);
  const embedded = await getEmbeddingsBySourceIds(organizationId, 'CHUNK', chunkIds);
  const embeddedIds = new Set(embedded.map((row) => row.sourceId));

  return {
    knowledgeDocumentId,
    title: document.entity.title,
    chunkCount: document.chunks.length,
    embeddedChunkCount: embeddedIds.size,
    chunks: document.chunks.map((chunk) => ({
      id: chunk.id,
      position: chunk.position,
      embedded: embeddedIds.has(chunk.id),
      preview: chunk.content.slice(0, 160),
    })),
  };
}
