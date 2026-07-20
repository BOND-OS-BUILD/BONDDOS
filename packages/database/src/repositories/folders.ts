import { prisma } from '../client';
import type { Prisma } from '../generated/index.js';

export interface FolderNode {
  id: string;
  name: string;
  parentFolderId: string | null;
  documentCount: number;
  createdAt: Date;
}

const include = {
  _count: { select: { documents: true } },
} satisfies Prisma.FolderInclude;

type FolderWithCount = Prisma.FolderGetPayload<{ include: typeof include }>;

function toNode(folder: FolderWithCount): FolderNode {
  return {
    id: folder.id,
    name: folder.name,
    parentFolderId: folder.parentFolderId,
    documentCount: folder._count.documents,
    createdAt: folder.createdAt,
  };
}

/** Every folder in the org, flat (the UI builds the tree client-side from `parentFolderId`). */
export async function listFolders(organizationId: string): Promise<FolderNode[]> {
  const folders = await prisma.folder.findMany({
    where: { organizationId },
    include,
    orderBy: { name: 'asc' },
  });
  return folders.map(toNode);
}

export interface CreateFolderData {
  organizationId: string;
  name: string;
  parentFolderId?: string | null;
  createdById?: string | null;
}

export async function createFolder(data: CreateFolderData): Promise<FolderNode> {
  const folder = await prisma.folder.create({
    data,
    include,
  });
  return toNode(folder);
}

export async function renameFolder(id: string, organizationId: string, name: string): Promise<boolean> {
  const result = await prisma.folder.updateMany({ where: { id, organizationId }, data: { name } });
  return result.count > 0;
}

/** Deletes a folder; documents inside are NOT deleted (their `folderId` becomes null via onDelete: SetNull). */
export async function deleteFolder(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.folder.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
