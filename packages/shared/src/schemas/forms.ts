import { z } from 'zod';

import { CUSTOM_FIELD_TYPES } from '../custom-fields';

/** Phase 11 — dynamic form definition + submission schemas. */

export const formFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(KEY_RE, 'Use a lowercase key: letters, numbers and underscores, starting with a letter.');

export const formFieldSchema = z
  .object({
    key: keySchema,
    label: z.string().trim().min(1, 'A label is required.').max(120),
    fieldType: formFieldTypeSchema,
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1)).max(100).default([]),
    placeholder: z.string().trim().max(120).optional(),
    helpText: z.string().trim().max(280).optional(),
  })
  .refine((field) => !['SELECT', 'MULTISELECT'].includes(field.fieldType) || field.options.length > 0, {
    message: 'Select and multi-select fields need at least one option.',
    path: ['options'],
  });
export type FormFieldInput = z.infer<typeof formFieldSchema>;

export const createFormSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1, 'A name is required.').max(120),
  description: z.string().trim().max(500).optional(),
  fields: z.array(formFieldSchema).min(1, 'Add at least one field.').max(60),
  /** When set, a valid submission creates a record of this custom object. */
  customObjectKey: z.string().trim().max(60).optional(),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullish(),
  fields: z.array(formFieldSchema).min(1).max(60).optional(),
  customObjectKey: z.string().trim().max(60).nullish(),
  enabled: z.boolean().optional(),
});
export type UpdateFormInput = z.infer<typeof updateFormSchema>;

export const submitFormSchema = z.object({
  values: z.record(z.unknown()).default({}),
});
export type SubmitFormInput = z.infer<typeof submitFormSchema>;
