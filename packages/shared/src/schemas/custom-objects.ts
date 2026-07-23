import { z } from 'zod';

import { CUSTOM_FIELD_TYPES } from '../custom-fields';

/** Phase 11 — custom object & field definition schemas. */

export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(KEY_RE, 'Use a lowercase key: letters, numbers and underscores, starting with a letter.');

export const fieldDefinitionInputSchema = z
  .object({
    key: keySchema,
    label: z.string().trim().min(1, 'A label is required.').max(120),
    fieldType: customFieldTypeSchema,
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1)).max(100).default([]),
    order: z.number().int().min(0).default(0),
  })
  .refine((field) => !['SELECT', 'MULTISELECT'].includes(field.fieldType) || field.options.length > 0, {
    message: 'Select and multi-select fields need at least one option.',
    path: ['options'],
  });
export type FieldDefinitionInput = z.infer<typeof fieldDefinitionInputSchema>;

export const createObjectDefinitionSchema = z.object({
  key: keySchema,
  name: z.string().trim().min(1, 'A name is required.').max(120),
  pluralName: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  icon: z.string().trim().max(60).optional(),
  fields: z.array(fieldDefinitionInputSchema).max(60).default([]),
});
export type CreateObjectDefinitionInput = z.infer<typeof createObjectDefinitionSchema>;

export const updateObjectDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  pluralName: z.string().trim().max(120).nullish(),
  description: z.string().trim().max(500).nullish(),
  icon: z.string().trim().max(60).nullish(),
  /** When present, fully replaces the object's field set. */
  fields: z.array(fieldDefinitionInputSchema).max(60).optional(),
});
export type UpdateObjectDefinitionInput = z.infer<typeof updateObjectDefinitionSchema>;

export const customRecordInputSchema = z.object({
  title: z.string().trim().max(200).optional(),
  values: z.record(z.unknown()).default({}),
});
export type CustomRecordInput = z.infer<typeof customRecordInputSchema>;

export const createRelationshipDefinitionSchema = z.object({
  key: keySchema,
  label: z.string().trim().min(1).max(120),
  sourceObjectKey: keySchema,
  targetObjectKey: keySchema,
});
export type CreateRelationshipDefinitionInput = z.infer<typeof createRelationshipDefinitionSchema>;
