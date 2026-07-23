import { requireRole } from '@bond-os/auth';
import {
  createCustomRecord,
  createObjectDefinition,
  deleteCustomRecord,
  deleteObjectDefinition,
  getCustomRecord,
  getObjectDefinitionByKey,
  listCustomRecords,
  listFieldDefinitions,
  listObjectDefinitions,
  updateCustomRecord,
  updateObjectDefinition,
  type CustomFieldDefinitionRecord,
  type CustomObjectDefinitionRecord,
  type CustomRecord,
} from '@bond-os/database';
import {
  ConflictError,
  NotFoundError,
  ROLES,
  ValidationError,
  pickKnownValues,
  validateFieldValues,
  type CreateObjectDefinitionInput,
  type CustomRecordInput,
  type PaginatedResult,
  type UpdateObjectDefinitionInput,
  type ValidatableField,
} from '@bond-os/shared';

import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Phase 11 — custom objects. Defining/altering an object is a schema-level,
 * ADMIN-only operation; creating and editing records is a MEMBER operation.
 * Records are validated against the object's field definitions and stored as
 * Knowledge Graph `Entity` rows (see the repository), so they participate in
 * the graph and search for free.
 */

export interface CustomFieldView {
  key: string;
  label: string;
  fieldType: CustomFieldDefinitionRecord['fieldType'];
  required: boolean;
  options: string[];
  order: number;
}

export interface CustomObjectView {
  key: string;
  name: string;
  pluralName: string | null;
  description: string | null;
  icon: string | null;
  fieldCount: number;
  createdAt: string;
}

export interface CustomObjectDetail extends CustomObjectView {
  fields: CustomFieldView[];
}

function toObjectView(definition: CustomObjectDefinitionRecord, fieldCount: number): CustomObjectView {
  return {
    key: definition.key,
    name: definition.name,
    pluralName: definition.pluralName,
    description: definition.description,
    icon: definition.icon,
    fieldCount,
    createdAt: definition.createdAt.toISOString(),
  };
}

function toFieldView(field: CustomFieldDefinitionRecord): CustomFieldView {
  return {
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    options: field.options,
    order: field.order,
  };
}

function toValidatable(fields: CustomFieldDefinitionRecord[]): ValidatableField[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    options: field.options,
  }));
}

async function requireAdminOrg(): Promise<string> {
  const organizationId = await requireActiveOrganizationId();
  await requireRole(organizationId, ROLES.ADMIN);
  return organizationId;
}

async function requireMemberOrg(): Promise<string> {
  const organizationId = await requireActiveOrganizationId();
  await requireRole(organizationId, ROLES.MEMBER);
  return organizationId;
}

// ── Definitions ────────────────────────────────────────────────────────────

export async function listCustomObjectsService(): Promise<CustomObjectView[]> {
  const organizationId = await requireMemberOrg();
  const definitions = await listObjectDefinitions(organizationId);
  const views = await Promise.all(
    definitions.map(async (definition) => {
      const fields = await listFieldDefinitions(definition.id);
      return toObjectView(definition, fields.length);
    }),
  );
  return views;
}

async function loadObjectOrThrow(
  organizationId: string,
  key: string,
): Promise<{ definition: CustomObjectDefinitionRecord; fields: CustomFieldDefinitionRecord[] }> {
  const definition = await getObjectDefinitionByKey(organizationId, key);
  if (!definition) throw new NotFoundError('Custom object not found.');
  const fields = await listFieldDefinitions(definition.id);
  return { definition, fields };
}

export async function getCustomObjectService(key: string): Promise<CustomObjectDetail> {
  const organizationId = await requireMemberOrg();
  const { definition, fields } = await loadObjectOrThrow(organizationId, key);
  return { ...toObjectView(definition, fields.length), fields: fields.map(toFieldView) };
}

export async function createCustomObjectService(input: CreateObjectDefinitionInput): Promise<CustomObjectDetail> {
  const organizationId = await requireAdminOrg();
  const existing = await getObjectDefinitionByKey(organizationId, input.key);
  if (existing) throw new ConflictError(`A custom object with key "${input.key}" already exists.`);

  assertUniqueFieldKeys(input.fields);
  const definition = await createObjectDefinition({
    organizationId,
    key: input.key,
    name: input.name,
    pluralName: input.pluralName ?? null,
    description: input.description ?? null,
    icon: input.icon ?? null,
    fields: input.fields.map((field, index) => ({
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      options: field.options,
      order: field.order || index,
    })),
  });
  const fields = await listFieldDefinitions(definition.id);
  return { ...toObjectView(definition, fields.length), fields: fields.map(toFieldView) };
}

export async function updateCustomObjectService(
  key: string,
  input: UpdateObjectDefinitionInput,
): Promise<CustomObjectDetail> {
  const organizationId = await requireAdminOrg();
  const { definition } = await loadObjectOrThrow(organizationId, key);
  if (input.fields) assertUniqueFieldKeys(input.fields);

  await updateObjectDefinition(definition.id, organizationId, {
    name: input.name,
    pluralName: input.pluralName ?? undefined,
    description: input.description ?? undefined,
    icon: input.icon ?? undefined,
    fields: input.fields?.map((field, index) => ({
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      required: field.required,
      options: field.options,
      order: field.order || index,
    })),
  });
  const fields = await listFieldDefinitions(definition.id);
  const refreshed = await getObjectDefinitionByKey(organizationId, key);
  return { ...toObjectView(refreshed ?? definition, fields.length), fields: fields.map(toFieldView) };
}

export async function deleteCustomObjectService(key: string): Promise<void> {
  const organizationId = await requireAdminOrg();
  const { definition } = await loadObjectOrThrow(organizationId, key);
  await deleteObjectDefinition(definition.id, organizationId, key);
}

function assertUniqueFieldKeys(fields: Array<{ key: string }>): void {
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.key)) throw new ValidationError(`Duplicate field key "${field.key}".`);
    seen.add(field.key);
  }
}

// ── Records ────────────────────────────────────────────────────────────────

export interface CustomRecordView {
  id: string;
  objectKey: string;
  title: string;
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function toRecordView(record: CustomRecord): CustomRecordView {
  return {
    id: record.id,
    objectKey: record.objectKey,
    title: record.title,
    values: record.values,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Validate + normalize a submission against the object's fields, or throw. */
function validateRecord(
  fields: CustomFieldDefinitionRecord[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const validatable = toValidatable(fields);
  const errors = validateFieldValues(validatable, values);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Some fields are invalid.', errors);
  }
  return pickKnownValues(validatable, values);
}

function deriveTitle(
  explicit: string | undefined,
  fields: CustomFieldDefinitionRecord[],
  values: Record<string, unknown>,
  objectName: string,
): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const firstText = fields.find((field) => field.fieldType === 'TEXT' && typeof values[field.key] === 'string');
  if (firstText) return String(values[firstText.key]).slice(0, 200);
  return `${objectName} record`;
}

export async function listCustomRecordsService(
  key: string,
  query: { page?: number; pageSize?: number; search?: string },
): Promise<PaginatedResult<CustomRecordView>> {
  const organizationId = await requireMemberOrg();
  await loadObjectOrThrow(organizationId, key);
  const page = await listCustomRecords({ organizationId, objectKey: key, ...query });
  return {
    items: page.items.map(toRecordView),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: page.totalPages,
  };
}

export async function createCustomRecordService(key: string, input: CustomRecordInput): Promise<CustomRecordView> {
  const organizationId = await requireMemberOrg();
  const { definition, fields } = await loadObjectOrThrow(organizationId, key);
  const values = validateRecord(fields, input.values);
  const title = deriveTitle(input.title, fields, values, definition.name);
  const record = await createCustomRecord({ organizationId, objectKey: key, title, values });
  return toRecordView(record);
}

export async function getCustomRecordService(key: string, id: string): Promise<CustomRecordView> {
  const organizationId = await requireMemberOrg();
  await loadObjectOrThrow(organizationId, key);
  const record = await getCustomRecord(id, organizationId, key);
  if (!record) throw new NotFoundError('Record not found.');
  return toRecordView(record);
}

export async function updateCustomRecordService(
  key: string,
  id: string,
  input: CustomRecordInput,
): Promise<CustomRecordView> {
  const organizationId = await requireMemberOrg();
  const { definition, fields } = await loadObjectOrThrow(organizationId, key);
  const values = validateRecord(fields, input.values);
  const title = deriveTitle(input.title, fields, values, definition.name);
  const record = await updateCustomRecord(id, organizationId, key, { title, values });
  if (!record) throw new NotFoundError('Record not found.');
  return toRecordView(record);
}

export async function deleteCustomRecordService(key: string, id: string): Promise<void> {
  const organizationId = await requireMemberOrg();
  await loadObjectOrThrow(organizationId, key);
  const deleted = await deleteCustomRecord(id, organizationId, key);
  if (!deleted) throw new NotFoundError('Record not found.');
}
