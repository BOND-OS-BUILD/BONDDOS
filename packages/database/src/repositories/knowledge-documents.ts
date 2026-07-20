import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { EntityType, ParseStatus, Prisma } from '../generated/index.js';
import { toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

const entitySummarySelect = {
  id: true,
  title: true,
  description: true,
  entityType: true,
} satisfies Prisma.EntitySelect;

export interface KnowledgeDocumentListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
  sortBy: 'title' | 'size' | 'createdAt';
  sortDir: 'asc' | 'desc';
  /** DOCUMENT vs FILE — the /library page's two tabs share this one table. */
  entityType?: EntityType;
  folderId?: string;
}

export interface KnowledgeDocumentListItem {
  id: string;
  entityId: string;
  title: string;
  description: string | null;
  entityType: EntityType;
  fileName: string;
  mimeType: string;
  size: number;
  parseStatus: ParseStatus;
  folder: { id: string; name: string } | null;
  uploadedBy: UserSummary | null;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentListItem {
  organizationId: string;
  storagePath: string;
  parsedText: string | null;
  parsedPages: unknown;
  parsedMetadata: unknown;
  tags: Array<{ id: string; name: string; color: string | null }>;
  chunks: Array<{
    id: string;
    chunkType: string;
    position: number;
    content: string;
    pageNumber: number | null;
  }>;
}

const listInclude = {
  entity: { select: entitySummarySelect },
  folder: { select: { id: true, name: true } },
  uploadedBy: { select: userSummarySelect },
  _count: { select: { chunks: true } },
} satisfies Prisma.KnowledgeDocumentInclude;

type KnowledgeDocumentWithRelations = Prisma.KnowledgeDocumentGetPayload<{ include: typeof listInclude }>;

function toListItem(doc: KnowledgeDocumentWithRelations): KnowledgeDocumentListItem {
  return {
    id: doc.id,
    entityId: doc.entityId,
    title: doc.entity.title,
    description: doc.entity.description,
    entityType: doc.entity.entityType,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    size: doc.size,
    parseStatus: doc.parseStatus,
    folder: doc.folder,
    uploadedBy: toUserSummaryOrNull(doc.uploadedBy),
    chunkCount: doc._count.chunks,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listKnowledgeDocuments(
  filters: KnowledgeDocumentListFilters,
): Promise<PaginatedResult<KnowledgeDocumentListItem>> {
  const { organizationId, page, pageSize, search, sortBy, sortDir, entityType, folderId } = filters;

  const where: Prisma.KnowledgeDocumentWhereInput = {
    organizationId,
    ...(folderId && { folderId }),
    ...(entityType && { entity: { entityType } }),
    ...(search && { entity: { title: { contains: search, mode: 'insensitive' } } }),
  };

  const orderBy: Prisma.KnowledgeDocumentOrderByWithRelationInput =
    sortBy === 'title' ? { entity: { title: sortDir } } : { [sortBy]: sortDir };

  const [items, total] = await Promise.all([
    prisma.knowledgeDocument.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: listInclude,
    }),
    prisma.knowledgeDocument.count({ where }),
  ]);

  return {
    items: items.map(toListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getKnowledgeDocumentById(
  id: string,
  organizationId: string,
): Promise<KnowledgeDocumentDetail | null> {
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id, organizationId },
    include: {
      entity: {
        select: {
          ...entitySummarySelect,
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        },
      },
      folder: { select: { id: true, name: true } },
      uploadedBy: { select: userSummarySelect },
      chunks: { orderBy: { position: 'asc' } },
    },
  });

  if (!doc) return null;

  return {
    id: doc.id,
    entityId: doc.entityId,
    organizationId: doc.organizationId,
    title: doc.entity.title,
    description: doc.entity.description,
    entityType: doc.entity.entityType,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    size: doc.size,
    storagePath: doc.storagePath,
    parseStatus: doc.parseStatus,
    parsedText: doc.parsedText,
    parsedPages: doc.parsedPages,
    parsedMetadata: doc.parsedMetadata,
    folder: doc.folder,
    uploadedBy: toUserSummaryOrNull(doc.uploadedBy),
    tags: doc.entity.tags.map((entityTag) => entityTag.tag),
    chunks: doc.chunks.map((chunk) => ({
      id: chunk.id,
      chunkType: chunk.chunkType,
      position: chunk.position,
      content: chunk.content,
      pageNumber: chunk.pageNumber,
    })),
    chunkCount: doc.chunks.length,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export interface CreateKnowledgeDocumentData {
  organizationId: string;
  creatorId?: string | null;
  entityType: EntityType;
  title: string;
  description?: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  folderId?: string | null;
  sourceId?: string | null;
  uploadedById?: string | null;
}

/** Creates the Entity + KnowledgeDocument pair atomically via a nested write. */
export async function createKnowledgeDocument(
  data: CreateKnowledgeDocumentData,
): Promise<KnowledgeDocumentDetail> {
  const created = await prisma.entity.create({
    data: {
      organizationId: data.organizationId,
      creatorId: data.creatorId,
      entityType: data.entityType,
      title: data.title,
      description: data.description,
      knowledgeDocument: {
        create: {
          organizationId: data.organizationId,
          fileName: data.fileName,
          mimeType: data.mimeType,
          size: data.size,
          storagePath: data.storagePath,
          folderId: data.folderId,
          sourceId: data.sourceId,
          uploadedById: data.uploadedById,
        },
      },
    },
    select: { knowledgeDocument: { select: { id: true } } },
  });

  const detail = await getKnowledgeDocumentById(created.knowledgeDocument!.id, data.organizationId);
  if (!detail) throw new Error('Failed to load knowledge document immediately after creation.');
  return detail;
}

export interface UpdateKnowledgeDocumentData {
  title?: string;
  description?: string | null;
  folderId?: string | null;
  tagIds?: string[];
}

/**
 * Metadata-only update. Reads the row scoped by `organizationId` first (a
 * `KnowledgeDocument.update`'s unique-`id`-only `where` can't also filter by
 * org) — the subsequent writes only run if that scoped read found a row.
 */
export async function updateKnowledgeDocument(
  id: string,
  organizationId: string,
  data: UpdateKnowledgeDocumentData,
): Promise<KnowledgeDocumentDetail | null> {
  const { title, description, folderId, tagIds } = data;

  const updated = await prisma.$transaction(async (tx) => {
    const doc = await tx.knowledgeDocument.findFirst({ where: { id, organizationId }, select: { entityId: true } });
    if (!doc) return false;

    if (title !== undefined || description !== undefined) {
      await tx.entity.update({ where: { id: doc.entityId }, data: { title, description } });
    }
    if (folderId !== undefined) {
      await tx.knowledgeDocument.update({ where: { id }, data: { folderId } });
    }
    if (tagIds) {
      await tx.entityTag.deleteMany({ where: { entityId: doc.entityId } });
      if (tagIds.length > 0) {
        await tx.entityTag.createMany({
          data: tagIds.map((tagId) => ({ entityId: doc.entityId, tagId })),
          skipDuplicates: true,
        });
      }
    }
    return true;
  });

  if (!updated) return null;
  return getKnowledgeDocumentById(id, organizationId);
}

export interface ParseResultUpdate {
  status: ParseStatus;
  text?: string | null;
  pages?: unknown;
  metadata?: unknown;
}

/** Called by the parsing pipeline once extraction finishes (or fails). */
export async function updateParseResult(id: string, organizationId: string, result: ParseResultUpdate): Promise<void> {
  await prisma.knowledgeDocument.updateMany({
    where: { id, organizationId },
    data: {
      parseStatus: result.status,
      parsedText: result.text,
      parsedPages: result.pages as Prisma.InputJsonValue,
      parsedMetadata: result.metadata as Prisma.InputJsonValue,
    },
  });
}

/** Deletes the underlying Entity (cascades to KnowledgeDocument/Chunks/etc). Returns the storage path so the caller can also delete the file. */
export async function deleteKnowledgeDocument(
  id: string,
  organizationId: string,
): Promise<{ deleted: boolean; storagePath?: string }> {
  const doc = await prisma.knowledgeDocument.findFirst({
    where: { id, organizationId },
    select: { entityId: true, storagePath: true },
  });
  if (!doc) return { deleted: false };

  await prisma.entity.delete({ where: { id: doc.entityId } });
  return { deleted: true, storagePath: doc.storagePath };
}
