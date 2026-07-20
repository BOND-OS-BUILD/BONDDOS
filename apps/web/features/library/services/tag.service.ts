import { requireRole } from '@bond-os/auth';
import { deleteTag, findOrCreateTag, listTags, type TagSummary } from '@bond-os/database';
import { NotFoundError, ROLES, type CreateTagInput } from '@bond-os/shared';

export async function listTagsService(organizationId: string): Promise<TagSummary[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listTags(organizationId);
}

export async function createTagService(organizationId: string, input: CreateTagInput): Promise<TagSummary> {
  await requireRole(organizationId, ROLES.MEMBER);
  return findOrCreateTag({ organizationId, name: input.name, color: input.color });
}

export async function deleteTagService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteTag(id, organizationId);
  if (!deleted) throw new NotFoundError('Tag not found.');
}
