'use client';

import { Plus, Trash2 } from 'lucide-react';

import { CUSTOM_FIELD_TYPE_META, type CustomFieldTypeName } from '@bond-os/shared';
import { Button, Checkbox, Input } from '@bond-os/ui';

/** A single field being edited in the builder (shared by objects and forms). */
export interface EditableField {
  key: string;
  label: string;
  fieldType: CustomFieldTypeName;
  required: boolean;
  options: string[];
}

export function emptyField(): EditableField {
  return { key: '', label: '', fieldType: 'TEXT', required: false, options: [] };
}

const NATIVE_SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

interface FieldsEditorProps {
  fields: EditableField[];
  onChange: (fields: EditableField[]) => void;
}

/** Reusable dynamic field-list builder for custom objects and dynamic forms. */
export function FieldsEditor({ fields, onChange }: FieldsEditorProps) {
  function update(index: number, patch: Partial<EditableField>) {
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function updateLabel(index: number, label: string) {
    const field = fields[index]!;
    const patch: Partial<EditableField> = { label };
    // Auto-derive the key from the label until the user has typed a custom key.
    if (!field.key || field.key === slugify(field.label)) patch.key = slugify(label);
    update(index, patch);
  }

  return (
    <div className="space-y-3">
      {fields.map((field, index) => {
        const needsOptions = field.fieldType === 'SELECT' || field.fieldType === 'MULTISELECT';
        return (
          <div key={index} className="rounded-md border border-border p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                placeholder="Label"
                value={field.label}
                onChange={(event) => updateLabel(index, event.target.value)}
              />
              <select
                className={NATIVE_SELECT_CLASS}
                value={field.fieldType}
                onChange={(event) => update(index, { fieldType: event.target.value as CustomFieldTypeName })}
              >
                {CUSTOM_FIELD_TYPE_META.map((meta) => (
                  <option key={meta.type} value={meta.type}>
                    {meta.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onChange(fields.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Remove field</span>
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Input
                className="h-8 max-w-[180px] text-xs"
                placeholder="field_key"
                value={field.key}
                onChange={(event) => update(index, { key: event.target.value })}
              />
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  checked={field.required}
                  onCheckedChange={(value) => update(index, { required: value === true })}
                />
                Required
              </label>
              {needsOptions && (
                <Input
                  className="h-8 flex-1 text-xs"
                  placeholder="Options, comma-separated"
                  value={field.options.join(', ')}
                  onChange={(event) =>
                    update(index, {
                      options: event.target.value
                        .split(',')
                        .map((option) => option.trim())
                        .filter(Boolean),
                    })
                  }
                />
              )}
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...fields, emptyField()])}>
        <Plus className="mr-1 h-4 w-4" /> Add field
      </Button>
    </div>
  );
}
