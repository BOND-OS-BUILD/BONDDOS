'use client';

import * as React from 'react';
import { SendHorizontal } from 'lucide-react';

import { Button, Textarea } from '@bond-os/ui';

export interface PromptBoxProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Chat composer — Enter sends, Shift+Enter inserts a newline. Disabled
 * (textarea + send button) while a response is streaming, so a caller just
 * passes `disabled={isStreaming}`.
 */
export function PromptBox({ onSend, disabled = false, placeholder = 'Ask Mr. Bond anything…' }: PromptBoxProps) {
  const [value, setValue] = React.useState('');

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-border pt-4">
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        maxLength={8000}
        disabled={disabled}
        className="max-h-40 min-h-[2.5rem] flex-1 resize-none"
      />
      <Button
        type="button"
        size="icon"
        disabled={disabled || value.trim().length === 0}
        onClick={submit}
        aria-label="Send message"
      >
        <SendHorizontal className="h-4 w-4" />
      </Button>
    </div>
  );
}
