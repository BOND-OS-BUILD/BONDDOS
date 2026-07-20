'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@bond-os/ui';

import type { AvailableAgent } from '@/features/agents/services/agent-discovery.service';

export interface AgentPickerProps {
  agents: AvailableAgent[];
  /** Controlled selected value — omit for an uncontrolled picker that only reports via `onSelect`. */
  value?: string;
  onSelect: (agentKey: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A plain agent-select dropdown (Radix `Select`, `@bond-os/ui`) — lists
 * every agent handed in via `agents` by `displayName`, reporting the chosen
 * `agentKey` through `onSelect`. No fetching or state of its own beyond the
 * native Select's open/closed; callers own `agents` (typically
 * `listAgentsService`'s result, passed down from a server component) and,
 * if they want a controlled picker, `value`.
 */
export function AgentPicker({
  agents,
  value,
  onSelect,
  placeholder = 'Choose an agent…',
  disabled = false,
  className,
}: AgentPickerProps) {
  return (
    <Select value={value} onValueChange={onSelect} disabled={disabled || agents.length === 0}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {agents.map((agent) => (
          <SelectItem key={agent.agentKey} value={agent.agentKey}>
            {agent.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
