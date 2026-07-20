'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';

import type { OrganizationAiSettingsData } from '@bond-os/database';
import { AI_PROVIDER_IDS, updateOrganizationAiSettingsSchema, type UpdateOrganizationAiSettingsInput } from '@bond-os/shared';
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@bond-os/ui';

export interface AiSettingsFormProps {
  currentSettings: OrganizationAiSettingsData | null;
}

const USE_ENV_DEFAULT = 'USE_ENV_DEFAULT';

const PROVIDER_LABELS: Record<(typeof AI_PROVIDER_IDS)[number], string> = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  GEMINI: 'Gemini',
  OLLAMA: 'Ollama',
};

/** Turns a `Number(...)` field's empty-string clear back into `null`, matching the schema's nullable-to-fall-back-to-env-default contract. */
function toNullableNumber(raw: string): number | null {
  return raw === '' ? null : Number(raw);
}

/**
 * Spec §13 — org-level overrides for the env-var AI defaults shown read-only
 * on the rest of this page. Every field is independently nullable: clearing
 * a field back to "Use environment default" (or blank, for numbers) restores
 * the env fallback rather than any hardcoded product default.
 */
export function AiSettingsForm({ currentSettings }: AiSettingsFormProps) {
  const router = useRouter();

  const form = useForm<UpdateOrganizationAiSettingsInput>({
    resolver: zodResolver(updateOrganizationAiSettingsSchema),
    defaultValues: {
      provider: (currentSettings?.provider ?? null) as UpdateOrganizationAiSettingsInput['provider'],
      model: currentSettings?.model ?? null,
      temperature: currentSettings?.temperature ?? null,
      topP: currentSettings?.topP ?? null,
      maxTokens: currentSettings?.maxTokens ?? null,
      streamingEnabled: currentSettings?.streamingEnabled ?? true,
      contextWindow: currentSettings?.contextWindow ?? null,
      retrievalDepth: currentSettings?.retrievalDepth ?? null,
    },
  });

  async function onSubmit(values: UpdateOrganizationAiSettingsInput) {
    const response = await fetch('/api/ai/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const result = await response.json();

    if (!result.success) {
      toast.error(result.error.message);
      return;
    }

    toast.success('AI settings updated.');
    router.refresh();
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="provider"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Provider</FormLabel>
                <Select
                  value={field.value ?? USE_ENV_DEFAULT}
                  onValueChange={(value) =>
                    field.onChange(value === USE_ENV_DEFAULT ? null : (value as UpdateOrganizationAiSettingsInput['provider']))
                  }
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={USE_ENV_DEFAULT}>Use environment default</SelectItem>
                    {AI_PROVIDER_IDS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {PROVIDER_LABELS[provider]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="model"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Model</FormLabel>
                <FormControl>
                  <Input
                    placeholder="Use environment default"
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(event.target.value === '' ? null : event.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="temperature"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Temperature (0-2)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    placeholder="Use environment default"
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(toNullableNumber(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="topP"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Top P (0-1)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    placeholder="Use environment default"
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(toNullableNumber(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="maxTokens"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max tokens</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="1"
                    min={1}
                    max={32000}
                    placeholder="Use environment default"
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(toNullableNumber(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="contextWindow"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Context token budget</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="1"
                    min={100}
                    max={200000}
                    placeholder="Use environment default"
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(toNullableNumber(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="retrievalDepth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Retrieval depth</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="1"
                    min={1}
                    max={100}
                    placeholder="Use environment default"
                    value={field.value ?? ''}
                    onChange={(event) => field.onChange(toNullableNumber(event.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="streamingEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center gap-2 space-y-0 pt-6">
                <FormControl>
                  <Checkbox
                    checked={field.value ?? true}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <FormLabel className="cursor-pointer font-normal">Enable streaming responses</FormLabel>
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Save overrides'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
