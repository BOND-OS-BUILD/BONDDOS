'use client';

import type { CustomFieldTypeName } from '@bond-os/shared';
import { Checkbox, Input, Label, Textarea } from '@bond-os/ui';

export interface RenderableField {
  key: string;
  label: string;
  fieldType: CustomFieldTypeName;
  required: boolean;
  options: string[];
}

const NATIVE_SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

interface RecordFormProps {
  fields: RenderableField[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

/** Renders a value-entry form derived from field definitions (objects + forms). */
export function RecordForm({ fields, values, onChange }: RecordFormProps) {
  function set(key: string, value: unknown) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const value = values[field.key];
        return (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-sm">
              {field.label}
              {field.required && <span className="ml-0.5 text-destructive">*</span>}
            </Label>
            {renderInput(field, value, set)}
          </div>
        );
      })}
    </div>
  );
}

function renderInput(
  field: RenderableField,
  value: unknown,
  set: (key: string, value: unknown) => void,
) {
  switch (field.fieldType) {
    case 'NUMBER':
      return (
        <Input
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) => set(field.key, event.target.value === '' ? undefined : Number(event.target.value))}
        />
      );
    case 'EMAIL':
      return <Input type="email" value={(value as string) ?? ''} onChange={(event) => set(field.key, event.target.value)} />;
    case 'PHONE':
      return <Input type="tel" value={(value as string) ?? ''} onChange={(event) => set(field.key, event.target.value)} />;
    case 'DATE':
      return <Input type="date" value={(value as string) ?? ''} onChange={(event) => set(field.key, event.target.value)} />;
    case 'FILE':
      return (
        <Input
          type="url"
          placeholder="https://…"
          value={(value as string) ?? ''}
          onChange={(event) => set(field.key, event.target.value)}
        />
      );
    case 'RICH_TEXT':
      return <Textarea rows={4} value={(value as string) ?? ''} onChange={(event) => set(field.key, event.target.value)} />;
    case 'CHECKBOX':
      return (
        <div>
          <Checkbox checked={value === true} onCheckedChange={(checked) => set(field.key, checked === true)} />
        </div>
      );
    case 'SELECT':
      return (
        <select className={NATIVE_SELECT_CLASS} value={(value as string) ?? ''} onChange={(event) => set(field.key, event.target.value || undefined)}>
          <option value="">Select…</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case 'MULTISELECT': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-3 rounded-md border border-border p-2">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={selected.includes(option)}
                onCheckedChange={(checked) =>
                  set(field.key, checked === true ? [...selected, option] : selected.filter((v) => v !== option))
                }
              />
              {option}
            </label>
          ))}
        </div>
      );
    }
    default:
      return <Input value={(value as string) ?? ''} onChange={(event) => set(field.key, event.target.value)} />;
  }
}
