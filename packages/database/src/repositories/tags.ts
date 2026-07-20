import { prisma } from '../client';

export interface TagSummary {
  id: string;
  name: string;
  color: string | null;
}

export async function listTags(organizationId: string): Promise<TagSummary[]> {
  return prisma.tag.findMany({
    where: { organizationId },
    select: { id: true, name: true, color: true },
    orderBy: { name: 'asc' },
  });
}

export interface CreateTagData {
  organizationId: string;
  name: string;
  color?: string | null;
}

/** Idempotent — reuses an existing tag with the same (org, name) instead of erroring on the unique constraint. */
export async function findOrCreateTag(data: CreateTagData): Promise<TagSummary> {
  const existing = await prisma.tag.findUnique({
    where: { organizationId_name: { organizationId: data.organizationId, name: data.name } },
  });
  if (existing) return existing;

  return prisma.tag.create({
    data,
    select: { id: true, name: true, color: true },
  });
}

export async function deleteTag(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.tag.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
