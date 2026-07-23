import type { Prisma } from '../generated';
import { prisma } from '../client';

/**
 * Phase 11 — dynamic form definitions. The field list + layout live in the
 * `schema` JSON column (`{ fields: [...] }`); a form may target a custom object
 * (`customObjectKey`) so a valid submission creates a record of it. Kept
 * deliberately generic so new field types never require a migration.
 */

export interface FormDefinitionRecord {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string | null;
  schema: Prisma.JsonValue;
  customObjectKey: string | null;
  enabled: boolean;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFormDefinitionData {
  organizationId: string;
  key: string;
  name: string;
  description?: string | null;
  schema: Prisma.InputJsonValue;
  customObjectKey?: string | null;
  createdById?: string | null;
}

export function createFormDefinition(data: CreateFormDefinitionData): Promise<FormDefinitionRecord> {
  return prisma.formDefinition.create({
    data: {
      organizationId: data.organizationId,
      key: data.key,
      name: data.name,
      description: data.description ?? null,
      schema: data.schema,
      customObjectKey: data.customObjectKey ?? null,
      createdById: data.createdById ?? null,
    },
  });
}

export function listFormDefinitions(organizationId: string): Promise<FormDefinitionRecord[]> {
  return prisma.formDefinition.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
}

export function getFormDefinitionByKey(
  organizationId: string,
  key: string,
): Promise<FormDefinitionRecord | null> {
  return prisma.formDefinition.findUnique({
    where: { organizationId_key: { organizationId, key } },
  });
}

export interface UpdateFormDefinitionData {
  name?: string;
  description?: string | null;
  schema?: Prisma.InputJsonValue;
  customObjectKey?: string | null;
  enabled?: boolean;
}

export function updateFormDefinition(
  id: string,
  data: UpdateFormDefinitionData,
): Promise<FormDefinitionRecord> {
  return prisma.formDefinition.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description,
      schema: data.schema,
      customObjectKey: data.customObjectKey,
      enabled: data.enabled,
    },
  });
}

export async function deleteFormDefinition(id: string): Promise<void> {
  await prisma.formDefinition.delete({ where: { id } });
}
