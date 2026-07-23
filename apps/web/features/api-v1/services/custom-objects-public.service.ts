import {
  createCustomRecord,
  getObjectDefinitionByKey,
  listCustomRecords,
  listFieldDefinitions,
  listObjectDefinitions,
  type CustomFieldDefinitionRecord,
} from '@bond-os/database';
import {
  NotFoundError,
  ValidationError,
  pickKnownValues,
  validateFieldValues,
  type ValidatableField,
} from '@bond-os/shared';

/**
 * Phase 11 — public API (`/api/v1`) custom-object read/write. Scope + org
 * authorization already happened in `apiV1Handler`; these reuse the same
 * repositories and the same shared field validator as the dashboard service,
 * so behavior is identical without depending on session RBAC.
 */

function toValidatable(fields: CustomFieldDefinitionRecord[]): ValidatableField[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    fieldType: field.fieldType,
    required: field.required,
    options: field.options,
  }));
}

export async function listCustomObjectsPublic(organizationId: string) {
  const definitions = await listObjectDefinitions(organizationId);
  return Promise.all(
    definitions.map(async (definition) => ({
      key: definition.key,
      name: definition.name,
      pluralName: definition.pluralName,
      description: definition.description,
      fieldCount: (await listFieldDefinitions(definition.id)).length,
    })),
  );
}

async function loadObject(organizationId: string, key: string) {
  const definition = await getObjectDefinitionByKey(organizationId, key);
  if (!definition) throw new NotFoundError('Custom object not found.');
  const fields = await listFieldDefinitions(definition.id);
  return { definition, fields };
}

export async function listCustomRecordsPublic(
  organizationId: string,
  key: string,
  query: { page?: number; pageSize?: number; search?: string },
) {
  await loadObject(organizationId, key);
  const page = await listCustomRecords({ organizationId, objectKey: key, ...query });
  return {
    items: page.items.map((record) => ({
      id: record.id,
      title: record.title,
      values: record.values,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: page.totalPages,
  };
}

export async function createCustomRecordPublic(
  organizationId: string,
  key: string,
  input: { title?: string; values: Record<string, unknown> },
) {
  const { definition, fields } = await loadObject(organizationId, key);
  const validatable = toValidatable(fields);
  const errors = validateFieldValues(validatable, input.values);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Some fields are invalid.', errors);
  }
  const values = pickKnownValues(validatable, input.values);
  const title = input.title?.trim() || `${definition.name} record`;
  const record = await createCustomRecord({ organizationId, objectKey: key, title, values });
  return {
    id: record.id,
    title: record.title,
    values: record.values,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
