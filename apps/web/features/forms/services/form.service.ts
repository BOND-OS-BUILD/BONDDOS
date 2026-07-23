import { requireRole } from '@bond-os/auth';
import {
  createCustomRecord,
  createFormDefinition,
  deleteFormDefinition,
  getFormDefinitionByKey,
  getObjectDefinitionByKey,
  listFieldDefinitions,
  listFormDefinitions,
  updateFormDefinition,
  type FormDefinitionRecord,
} from '@bond-os/database';
import {
  ConflictError,
  NotFoundError,
  ROLES,
  ValidationError,
  pickKnownValues,
  validateFieldValues,
  type CreateFormInput,
  type FormFieldInput,
  type SubmitFormInput,
  type UpdateFormInput,
  type ValidatableField,
} from '@bond-os/shared';

import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Phase 11 — dynamic forms. A form is a validated, versionless field set that
 * can optionally feed a custom object: a valid submission to a form with a
 * `customObjectKey` creates a record of that object. Field validation reuses
 * the same shared validator as Custom Objects, so the two stay consistent.
 * Managing forms is ADMIN; reading/submitting is MEMBER.
 */

export interface FormView {
  key: string;
  name: string;
  description: string | null;
  fields: FormFieldInput[];
  customObjectKey: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

function readFields(schema: FormDefinitionRecord['schema']): FormFieldInput[] {
  const parsed = schema as { fields?: FormFieldInput[] } | null;
  return Array.isArray(parsed?.fields) ? parsed!.fields : [];
}

function toView(record: FormDefinitionRecord): FormView {
  return {
    key: record.key,
    name: record.name,
    description: record.description,
    fields: readFields(record.schema),
    customObjectKey: record.customObjectKey,
    enabled: record.enabled,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toValidatable(fields: FormFieldInput[]): ValidatableField[] {
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

async function requireMemberOrg(): Promise<{ organizationId: string; userId: string }> {
  const organizationId = await requireActiveOrganizationId();
  const { session } = await requireRole(organizationId, ROLES.MEMBER);
  return { organizationId, userId: session.user.id };
}

function assertUniqueFieldKeys(fields: Array<{ key: string }>): void {
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.key)) throw new ValidationError(`Duplicate field key "${field.key}".`);
    seen.add(field.key);
  }
}

export async function listFormsService(): Promise<FormView[]> {
  const organizationId = await requireActiveOrganizationId();
  await requireRole(organizationId, ROLES.MEMBER);
  const records = await listFormDefinitions(organizationId);
  return records.map(toView);
}

export async function getFormService(key: string): Promise<FormView> {
  const organizationId = await requireActiveOrganizationId();
  await requireRole(organizationId, ROLES.MEMBER);
  const record = await getFormDefinitionByKey(organizationId, key);
  if (!record) throw new NotFoundError('Form not found.');
  return toView(record);
}

export async function createFormService(input: CreateFormInput): Promise<FormView> {
  const organizationId = await requireAdminOrg();
  const existing = await getFormDefinitionByKey(organizationId, input.key);
  if (existing) throw new ConflictError(`A form with key "${input.key}" already exists.`);
  assertUniqueFieldKeys(input.fields);

  const record = await createFormDefinition({
    organizationId,
    key: input.key,
    name: input.name,
    description: input.description ?? null,
    schema: { fields: input.fields },
    customObjectKey: input.customObjectKey ?? null,
  });
  return toView(record);
}

export async function updateFormService(key: string, input: UpdateFormInput): Promise<FormView> {
  const organizationId = await requireAdminOrg();
  const record = await getFormDefinitionByKey(organizationId, key);
  if (!record) throw new NotFoundError('Form not found.');
  if (input.fields) assertUniqueFieldKeys(input.fields);

  const updated = await updateFormDefinition(record.id, {
    name: input.name,
    description: input.description ?? undefined,
    schema: input.fields ? { fields: input.fields } : undefined,
    customObjectKey: input.customObjectKey ?? undefined,
    enabled: input.enabled,
  });
  return toView(updated);
}

export async function deleteFormService(key: string): Promise<void> {
  const organizationId = await requireAdminOrg();
  const record = await getFormDefinitionByKey(organizationId, key);
  if (!record) throw new NotFoundError('Form not found.');
  await deleteFormDefinition(record.id);
}

export interface FormSubmissionResult {
  ok: true;
  /** Set when the form targets a custom object and a record was created. */
  recordId: string | null;
}

export async function submitFormService(key: string, input: SubmitFormInput): Promise<FormSubmissionResult> {
  const { organizationId, userId } = await requireMemberOrg();
  const record = await getFormDefinitionByKey(organizationId, key);
  if (!record) throw new NotFoundError('Form not found.');
  if (!record.enabled) throw new ValidationError('This form is not accepting submissions.');

  const fields = readFields(record.schema);
  const validatable = toValidatable(fields);
  const errors = validateFieldValues(validatable, input.values);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Some fields are invalid.', errors);
  }
  const values = pickKnownValues(validatable, input.values);

  // If the form targets a custom object that still exists, materialize a record.
  if (record.customObjectKey) {
    const objectDef = await getObjectDefinitionByKey(organizationId, record.customObjectKey);
    if (objectDef) {
      const objectFields = await listFieldDefinitions(objectDef.id);
      const objectValidatable: ValidatableField[] = objectFields.map((field) => ({
        key: field.key,
        label: field.label,
        fieldType: field.fieldType,
        required: field.required,
        options: field.options,
      }));
      const created = await createCustomRecord({
        organizationId,
        creatorId: userId,
        objectKey: record.customObjectKey,
        title: `${record.name} submission`,
        values: pickKnownValues(objectValidatable, values),
      });
      return { ok: true, recordId: created.id };
    }
  }
  return { ok: true, recordId: null };
}
