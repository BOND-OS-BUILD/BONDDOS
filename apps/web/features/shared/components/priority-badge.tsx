import { Badge, type BadgeProps } from '@bond-os/ui';

const PRIORITY_VARIANT: Record<string, BadgeProps['variant']> = {
  LOW: 'secondary',
  MEDIUM: 'outline',
  HIGH: 'warning',
  URGENT: 'destructive',
};

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/** Shared by Project and Task, which both use the same `Priority` enum. */
export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge variant={PRIORITY_VARIANT[priority] ?? 'outline'}>{PRIORITY_LABEL[priority] ?? priority}</Badge>;
}
