import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { DocumentType, Prisma } from '../generated/index.js';
import { toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

export interface DocumentListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
  sortBy: 'title' | 'type' | 'size' | 'createdAt';
  sortDir: 'asc' | 'desc';
  type?: DocumentType;
  projectId?: string;
  meetingId?: string;
}

export interface DocumentListItem {
  id: string;
  title: string;
  description: string | null;
  type: DocumentType;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  project: { id: string; title: string } | null;
  meeting: { id: string; title: string } | null;
  uploadedBy: UserSummary | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentDetail extends DocumentListItem {
  organizationId: string;
  tasks: Array<{ id: string; title: string; status: string }>;
}

const listInclude = {
  project: { select: { id: true, title: true } },
  meeting: { select: { id: true, title: true } },
  uploadedBy: { select: userSummarySelect },
} satisfies Prisma.DocumentInclude;

type DocumentWithRelations = Prisma.DocumentGetPayload<{ include: typeof listInclude }>;

function toListItem(document: DocumentWithRelations): DocumentListItem {
  return {
    id: document.id,
    title: document.title,
    description: document.description,
    type: document.type,
    fileName: document.fileName,
    mimeType: document.mimeType,
    size: document.size,
    storagePath: document.storagePath,
    project: document.project,
    meeting: document.meeting,
    uploadedBy: toUserSummaryOrNull(document.uploadedBy),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export async function listDocuments(filters: DocumentListFilters): Promise<PaginatedResult<DocumentListItem>> {
  const { organizationId, page, pageSize, search, sortBy, sortDir, type, projectId, meetingId } = filters;

  const where: Prisma.DocumentWhereInput = {
    organizationId,
    ...(type && { type }),
    ...(projectId && { projectId }),
    ...(meetingId && { meetingId }),
    ...(search && { title: { contains: search, mode: 'insensitive' } }),
  };

  const [items, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: listInclude,
    }),
    prisma.document.count({ where }),
  ]);

  return {
    items: items.map(toListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getDocumentById(id: string, organizationId: string): Promise<DocumentDetail | null> {
  const document = await prisma.document.findFirst({
    where: { id, organizationId },
    include: {
      ...listInclude,
      tasks: {
        include: { task: { select: { id: true, title: true, status: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!document) return null;

  return {
    ...toListItem(document),
    organizationId: document.organizationId,
    tasks: document.tasks.map((taskDocument) => taskDocument.task),
  };
}

export interface CreateDocumentData {
  organizationId: string;
  title: string;
  description?: string | null;
  type: DocumentType;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  projectId?: string | null;
  meetingId?: string | null;
  uploadedById?: string | null;
  taskIds: string[];
}

export async function createDocument(data: CreateDocumentData): Promise<DocumentDetail> {
  const { taskIds, ...rest } = data;

  const document = await prisma.document.create({
    data: {
      ...rest,
      tasks: { create: taskIds.map((taskId) => ({ taskId })) },
    },
  });

  const detail = await getDocumentById(document.id, document.organizationId);
  if (!detail) throw new Error('Failed to load document immediately after creation.');
  return detail;
}

export interface UpdateDocumentData {
  title?: string;
  description?: string | null;
  type?: DocumentType;
  projectId?: string | null;
  meetingId?: string | null;
  taskIds?: string[];
}

/**
 * Updates a document, scoped to `organizationId` via `updateMany` (Prisma's
 * unique-`update` can't combine `id` with a non-unique `organizationId`
 * filter). Task-link replacement only runs if the scoped update actually
 * matched a row, so a cross-tenant `id` can't sneak a link mutation through
 * even though the field update itself was a no-op.
 */
export async function updateDocument(
  id: string,
  organizationId: string,
  data: UpdateDocumentData,
): Promise<DocumentDetail | null> {
  const { taskIds, ...rest } = data;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.document.updateMany({ where: { id, organizationId }, data: rest });
    if (result.count === 0) return false;

    if (taskIds) {
      await tx.taskDocument.deleteMany({ where: { documentId: id } });
      if (taskIds.length > 0) {
        await tx.taskDocument.createMany({
          data: taskIds.map((taskId) => ({ documentId: id, taskId })),
          skipDuplicates: true,
        });
      }
    }

    return true;
  });

  if (!updated) return null;
  return getDocumentById(id, organizationId);
}

export async function deleteDocument(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.document.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
