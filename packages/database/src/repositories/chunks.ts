import { prisma } from '../client';
import type { ChunkType } from '../generated/index.js';

export interface ChunkInput {
  chunkType: ChunkType;
  position: number;
  content: string;
  contentHash: string;
  pageNumber?: number | null;
}

/**
 * Replaces every chunk belonging to a KnowledgeDocument with a fresh set —
 * used both on first parse and on re-parse. Scoped to `organizationId` via
 * the parent lookup so a cross-tenant `knowledgeDocumentId` can't attach
 * chunks to someone else's document.
 */
export async function replaceChunks(
  knowledgeDocumentId: string,
  organizationId: string,
  chunks: ChunkInput[],
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.knowledgeDocument.findFirst({
      where: { id: knowledgeDocumentId, organizationId },
      select: { id: true },
    });
    if (!doc) return 0;

    await tx.chunk.deleteMany({ where: { knowledgeDocumentId } });
    if (chunks.length === 0) return 0;

    await tx.chunk.createMany({
      data: chunks.map((chunk) => ({ knowledgeDocumentId, ...chunk })),
    });
    return chunks.length;
  });
}

export async function listChunks(knowledgeDocumentId: string, organizationId: string) {
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id: knowledgeDocumentId, organizationId },
    select: { id: true },
  });
  if (!doc) return [];

  return prisma.chunk.findMany({
    where: { knowledgeDocumentId },
    orderBy: { position: 'asc' },
  });
}
