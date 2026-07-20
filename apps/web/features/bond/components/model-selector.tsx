'use client';

import * as React from 'react';

import type { ModelInfo } from '@bond-os/ai';
import type { ApiResponse } from '@bond-os/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@bond-os/ui';

/** Sentinel Select value for "no override" — Radix `Select.Item` cannot take an empty-string value. */
const DEFAULT_MODEL_VALUE = '__default__';

export interface ModelSelectorProps {
  /** The current per-message model override, or `undefined` to use the organization default. */
  value: string | undefined;
  /** Called with the chosen model id, or `undefined` when "Organization default" is selected. */
  onChange: (model: string | undefined) => void;
  disabled?: boolean;
}

/**
 * Per-message model override for the chat composer. Purely controlled client
 * state — the parent `ChatThread` owns `value` and forwards it into the
 * `/api/bond/chat` request body's optional `model` field.
 *
 * Options are populated from `GET /api/ai/models` on mount. If that call
 * fails or returns an empty list, only "Organization default" is shown —
 * this is graceful degradation, not an error state, so nothing is surfaced
 * to the user beyond a shorter dropdown.
 */
export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const [models, setModels] = React.useState<ModelInfo[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    fetch('/api/ai/models')
      .then((response) => response.json() as Promise<ApiResponse<ModelInfo[]>>)
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data.length > 0) {
          setModels(result.data);
        }
      })
      .catch(() => {
        // Graceful degradation: keep showing "Organization default" alone.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Select
      value={value ?? DEFAULT_MODEL_VALUE}
      onValueChange={(next) => onChange(next === DEFAULT_MODEL_VALUE ? undefined : next)}
      disabled={disabled}
    >
      <SelectTrigger className="w-[200px]" aria-label="Model">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_MODEL_VALUE}>Organization default</SelectItem>
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
