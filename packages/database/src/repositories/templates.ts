import type { Prisma, TemplateType } from '../generated';
import { prisma } from '../client';

/**
 * Phase 11 — the template marketplace. A template is a reusable, exportable
 * definition (a workflow, prompt, project, document, graph view or dashboard)
 * stored as type-specific JSON `content`. Templates are org-scoped, but a
 * template with `isPublic = true` is discoverable across organizations (its
 * `organizationId` may also be null for platform-provided templates).
 */

export interface TemplateRecord {
  id: string;
  organizationId: string | null;
  type: TemplateType;
  key: string;
  name: string;
  description: string | null;
  content: Prisma.JsonValue;
  author: string | null;
  version: string;
  isPublic: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplateData {
  organizationId: string | null;
  type: TemplateType;
  key: string;
  name: string;
  description?: string | null;
  content: Prisma.InputJsonValue;
  author?: string | null;
  version?: string;
  isPublic?: boolean;
  createdById?: string | null;
}

export function createTemplate(data: CreateTemplateData): Promise<TemplateRecord> {
  return prisma.template.create({
    data: {
      organizationId: data.organizationId,
      type: data.type,
      key: data.key,
      name: data.name,
      description: data.description ?? null,
      content: data.content,
      author: data.author ?? null,
      version: data.version ?? '1.0.0',
      isPublic: data.isPublic ?? false,
      createdById: data.createdById ?? null,
    },
  });
}

/**
 * Templates visible to an organization: its own templates plus every public
 * template (from any org or platform-provided). Optionally filtered by type.
 */
export function listVisibleTemplates(organizationId: string, type?: TemplateType): Promise<TemplateRecord[]> {
  return prisma.template.findMany({
    where: {
      ...(type ? { type } : {}),
      OR: [{ organizationId }, { isPublic: true }],
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export function getTemplateById(id: string): Promise<TemplateRecord | null> {
  return prisma.template.findUnique({ where: { id } });
}

export interface UpdateTemplateData {
  name?: string;
  description?: string | null;
  content?: Prisma.InputJsonValue;
  isPublic?: boolean;
  version?: string;
}

export function updateTemplate(id: string, data: UpdateTemplateData): Promise<TemplateRecord> {
  return prisma.template.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      content: data.content,
      isPublic: data.isPublic,
      version: data.version,
    },
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  await prisma.template.delete({ where: { id } });
}
