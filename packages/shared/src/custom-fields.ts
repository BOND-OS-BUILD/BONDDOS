/**
 * Phase 11 — the custom field-type system (client-safe). Custom Objects and
 * Dynamic Forms share the exact same ten field types, so the type catalog and
 * value validation live here once and are reused by both (and by the SDK/UI).
 * Pure functions only — no server or Prisma imports.
 */

export const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'EMAIL',
  'PHONE',
  'SELECT',
  'MULTISELECT',
  'CHECKBOX',
  'DATE',
  'RICH_TEXT',
  'FILE',
] as const;

export type CustomFieldTypeName = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomFieldTypeMeta {
  type: CustomFieldTypeName;
  label: string;
  /** Whether this type requires a non-empty `options` list (SELECT/MULTISELECT). */
  hasOptions: boolean;
}

export const CUSTOM_FIELD_TYPE_META: readonly CustomFieldTypeMeta[] = [
  { type: 'TEXT', label: 'Text', hasOptions: false },
  { type: 'NUMBER', label: 'Number', hasOptions: false },
  { type: 'EMAIL', label: 'Email', hasOptions: false },
  { type: 'PHONE', label: 'Phone', hasOptions: false },
  { type: 'SELECT', label: 'Select (one)', hasOptions: true },
  { type: 'MULTISELECT', label: 'Multi-select', hasOptions: true },
  { type: 'CHECKBOX', label: 'Checkbox', hasOptions: false },
  { type: 'DATE', label: 'Date', hasOptions: false },
  { type: 'RICH_TEXT', label: 'Rich text', hasOptions: false },
  { type: 'FILE', label: 'File URL', hasOptions: false },
];

/** The minimal field shape the validator needs (defs from either subsystem). */
export interface ValidatableField {
  key: string;
  label: string;
  fieldType: CustomFieldTypeName;
  required?: boolean;
  options?: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\d][\d\s()+.-]{4,}$/;

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Validate a single value against a field definition. Returns an error message,
 * or null when valid. `required` empties are the caller's concern via the map
 * validator below, but this also enforces it for single-value use.
 */
export function validateFieldValue(field: ValidatableField, value: unknown): string | null {
  if (isEmpty(value)) {
    return field.required ? `${field.label} is required.` : null;
  }

  switch (field.fieldType) {
    case 'TEXT':
    case 'RICH_TEXT':
      return typeof value === 'string' ? null : `${field.label} must be text.`;
    case 'FILE':
      return typeof value === 'string' ? null : `${field.label} must be a file reference.`;
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${field.label} must be a number.`;
    case 'EMAIL':
      return typeof value === 'string' && EMAIL_RE.test(value) ? null : `${field.label} must be a valid email.`;
    case 'PHONE':
      return typeof value === 'string' && PHONE_RE.test(value) ? null : `${field.label} must be a valid phone number.`;
    case 'CHECKBOX':
      return typeof value === 'boolean' ? null : `${field.label} must be true or false.`;
    case 'DATE':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? null
        : `${field.label} must be a valid date.`;
    case 'SELECT':
      return typeof value === 'string' && (field.options ?? []).includes(value)
        ? null
        : `${field.label} must be one of the allowed options.`;
    case 'MULTISELECT':
      return Array.isArray(value) && value.every((v) => (field.options ?? []).includes(v))
        ? null
        : `${field.label} must be a subset of the allowed options.`;
    default:
      return `${field.label} has an unknown field type.`;
  }
}

/**
 * Validate a record of values against field definitions. Returns a map of
 * `key -> error message` (empty when everything is valid). Unknown keys are
 * ignored (forward-compatible with additive field changes).
 */
export function validateFieldValues(
  fields: readonly ValidatableField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const error = validateFieldValue(field, values[field.key]);
    if (error) errors[field.key] = error;
  }
  return errors;
}

/** Keep only known field keys from a submitted value map (drops extras). */
export function pickKnownValues(
  fields: readonly ValidatableField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const known: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(values, field.key)) {
      known[field.key] = values[field.key];
    }
  }
  return known;
}
