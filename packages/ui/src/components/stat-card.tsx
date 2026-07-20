import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '../lib/utils';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  description?: string;
}

/** A single number + label metric tile — analytics/dashboard summary cards. */
function StatCard({ label, value, icon: Icon, description, className, ...props }: StatCardProps) {
  return (
    <div className={cn('rounded-lg border bg-card p-4 text-card-foreground shadow-sm', className)} {...props}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export { StatCard };
