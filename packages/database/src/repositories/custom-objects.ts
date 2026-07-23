import type { CustomFieldType, Prisma } from '../generated';
import { prisma } from '../client';

/**
 * Phase 11 — custom objects. Definitions (object + fields + relationships) get
 * their own tables, but INSTANCES reuse the Knowledge Graph `Entity` table
 * (`entityType = CUSTOM`), with the concrete object key and field values stored
 * in `Entity.metadata` as `{ customObjectKey, values }`. This means custom
 * records automatically participate in the graph, timeline, tags and search
 * rather than living in a parallel store.
 */

// ── Object definitions ─────────────────────────────────────────────────────

export interface CustomObjectDefinitionRecord {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  pluralName: string | null;
  description: string | null;
  icon: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomFieldDefinitionRecord {
  id: string;
  organizationId: string;
  objectDefinitionId: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options: string[];
  order: number;
}

export interface CreateObjectDefinitionData {
  organizationId: string;
  key: string;
  name: string;
  pluralName?: string | null;
  description?: string | null;
  icon?: string | null;
  createdById?: string | null;
  fields: Array<{
    key: string;
    label: string;
    fieldType: CustomFieldType;
    required: boolean;
    options: string[];
    order: number;
  }>;
}

/** Create an object definition and its fields atomically. */
export async function createObjectDefinition(
  data: CreateObjectDefinitionData,
): Promise<CustomObjectDefinitionRecord> {
  return prisma.$transaction(async (tx) => {
    const definition = await tx.customObjectDefinition.create({
      data: {
        organizationId: data.organizationId,
        key: data.key,
        name: data.name,
        pluralName: data.pluralName ?? null,
        description: data.description ?? null,
        icon: data.icon ?? null,
        createdById: data.createdById ?? null,
      },
    });
    if (data.fields.length > 0) {
      await tx.customFieldDefinition.createMany({
        data: data.fields.map((field) => ({
          organizationId: data.organizationId,
          objectDefinitionId: definition.id,
          key: field.key,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required,
          options: field.options,
          order: field.order,
        })),
      });
    }
    return definition;
  });
}

export function listObjectDefinitions(organizationId: string): Promise<CustomObjectDefinitionRecord[]> {
  return prisma.customObjectDefinition.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
  });
}

export function getObjectDefinitionByKey(
  organizationId: string,
  key: string,
): Promise<CustomObjectDefinitionRecord | null> {
  return prisma.customObjectDefinition.findUnique({
    where: { organizationId_key: { organizationId, key } },
  });
}

export function listFieldDefinitions(objectDefinitionId: string): Promise<CustomFieldDefinitionRecord[]> {
  return prisma.customFieldDefinition.findMany({
    where: { objectDefinitionId },
    orderBy: [{ order: 'asc' }, { key: 'asc' }],
  });
}

export interface UpdateObjectDefinitionData {
  name?: string;
  pluralName?: string | null;
  description?: string | null;
  icon?: string | null;
  /** When provided, fully replaces the field set. */
  fields?: CreateObjectDefinitionData['fields'];
}

export async function updateObjectDefinition(
  id: string,
  organizationId: string,
  data: UpdateObjectDefinitionData,
): Promise<CustomObjectDefinitionRecord> {
  return prisma.$transaction(async (tx) => {
    const definition = await tx.customObjectDefinition.update({
      where: { id },
      data: {
        name: data.name,
        pluralName: data.pluralName,
        description: data.description,
        icon: data.icon,
      },
    });
    if (data.fields) {
      await tx.customFieldDefinition.deleteMany({ where: { objectDefinitionId: id } });
      if (data.fields.length > 0) {
        await tx.customFieldDefinition.createMany({
          data: data.fields.map((field) => ({
            organizationId,
            objectDefinitionId: id,
            key: field.key,
            label: field.label,
            fieldType: field.fieldType,
            required: field.required,
            options: field.options,
            order: field.order,
          })),
        });
      }
    }
    return definition;
  });
}

/** Delete a definition, its fields, and every instance record of it. */
export async function deleteObjectDefinition(id: string, organizationId: string, key: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.customFieldDefinition.deleteMany({ where: { objectDefinitionId: id } });
    await tx.entity.deleteMany({
      where: {
        organizationId,
        entityType: 'CUSTOM',
        metadata: { path: ['customObjectKey'], equals: key },
      },
    });
    await tx.customObjectDefinition.delete({ where: { id } });
  });
}

// ── Relationship definitions ───────────────────────────────────────────────

export interface CustomRelationshipDefinitionRecord {
  id: string;
  organizationId: string;
  key: string;
  label: string;
  sourceObjectKey: string;
  targetObjectKey: string;
  createdAt: Date;
}

export function createRelationshipDefinition(data: {
  organizationId: string;
  key: string;
  label: string;
  sourceObjectKey: string;
  targetObjectKey: string;
}): Promise<CustomRelationshipDefinitionRecord> {
  return prisma.customRelationshipDefinition.create({ data });
}

export function listRelationshipDefinitions(organizationId: string): Promise<CustomRelationshipDefinitionRecord[]> {
  return prisma.customRelationshipDefinition.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function deleteRelationshipDefinition(id: string): Promise<void> {
  await prisma.customRelationshipDefinition.delete({ where: { id } });
}

// ── Instances (reuse Entity) ───────────────────────────────────────────────

export interface CustomRecord {
  id: string;
  organizationId: string;
  objectKey: string;
  title: string;
  values: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(entity: {
  id: string;
  organizationId: string;
  title: string;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): CustomRecord {
  const metadata = (entity.metadata as Record<string, unknown> | null) ?? {};
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    objectKey: String(metadata.customObjectKey ?? ''),
    title: entity.title,
    values: (metadata.values as Record<string, unknown>) ?? {},
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function createCustomRecord(data: {
  organizationId: string;
  creatorId?: string | null;
  objectKey: string;
  title: string;
  values: Record<string, unknown>;
}): Promise<CustomRecord> {
  return prisma.entity
    .create({
      data: {
        organizationId: data.organizationId,
        creatorId: data.creatorId ?? null,
        entityType: 'CUSTOM',
        title: data.title,
        metadata: { customObjectKey: data.objectKey, values: data.values } as Prisma.InputJsonValue,
      },
    })
    .then(toRecord);
}

export interface CustomRecordPage {
  items: CustomRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listCustomRecords(params: {
  organizationId: string;
  objectKey: string;
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<CustomRecordPage> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.EntityWhereInput = {
    organizationId: params.organizationId,
    entityType: 'CUSTOM',
    metadata: { path: ['customObjectKey'], equals: params.objectKey },
    ...(params.search ? { title: { contains: params.search, mode: 'insensitive' } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.entity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.entity.count({ where }),
  ]);
  return {
    items: items.map(toRecord),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCustomRecord(
  id: string,
  organizationId: string,
  objectKey: string,
): Promise<CustomRecord | null> {
  const entity = await prisma.entity.findFirst({
    where: {
      id,
      organizationId,
      entityType: 'CUSTOM',
      metadata: { path: ['customObjectKey'], equals: objectKey },
    },
  });
  return entity ? toRecord(entity) : null;
}

export async function updateCustomRecord(
  id: string,
  organizationId: string,
  objectKey: string,
  data: { title: string; values: Record<string, unknown> },
): Promise<CustomRecord | null> {
  // Scoped update (org + type + object key) so a known id can never mutate
  // another org's row. `metadata` is fully rewritten with the preserved
  // objectKey + new values.
  const result = await prisma.entity.updateMany({
    where: {
      id,
      organizationId,
      entityType: 'CUSTOM',
      metadata: { path: ['customObjectKey'], equals: objectKey },
    },
    data: {
      title: data.title,
      metadata: { customObjectKey: objectKey, values: data.values } as Prisma.InputJsonValue,
    },
  });
  if (result.count === 0) return null;
  return getCustomRecord(id, organizationId, objectKey);
}

/** Delete one custom record (org + object-key scoped). Returns whether a row was removed. */
export async function deleteCustomRecord(
  id: string,
  organizationId: string,
  objectKey: string,
): Promise<boolean> {
  const result = await prisma.entity.deleteMany({
    where: {
      id,
      organizationId,
      entityType: 'CUSTOM',
      metadata: { path: ['customObjectKey'], equals: objectKey },
    },
  });
  return result.count > 0;
}
