import { requireRole } from '@bond-os/auth';
import { createFolder, deleteFolder, listFolders, renameFolder, type FolderNode } from '@bond-os/database';
import { NotFoundError, ROLES, type CreateFolderInput } from '@bond-os/shared';

export async function listFoldersService(organizationId: string): Promise<FolderNode[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listFolders(organizationId);
}

export async function createFolderService(
  organizationId: string,
  userId: string,
  input: CreateFolderInput,
): Promise<FolderNode> {
  await requireRole(organizationId, ROLES.MEMBER);
  return createFolder({ organizationId, name: input.name, parentFolderId: input.parentFolderId, createdById: userId });
}

export async function renameFolderService(organizationId: string, id: string, name: string): Promise<void> {
  await requireRole(organizationId, ROLES.MEMBER);
  const renamed = await renameFolder(id, organizationId, name);
  if (!renamed) throw new NotFoundError('Folder not found.');
}

export async function deleteFolderService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteFolder(id, organizationId);
  if (!deleted) throw new NotFoundError('Folder not found.');
}
