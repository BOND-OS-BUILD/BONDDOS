import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Phase 10 — dependency-free, theme-aware charts (no charting library). Pure
 * CSS/flex so they render as Server Components and adapt to light/dark via
 * the design tokens. Intentionally simple: bars for time series, horizontal
 * bars for breakdowns/top-N.
 */
export interface ChartDatum {
  label: string;
  value: number;
}

export interface BarChartProps extends React.HTMLAttributes<HTMLDivElement> {
  data: ChartDatum[];
  height?: number;
  valueFormatter?: (value: number) => string;
}

function BarChart({ data, height = 160, valueFormatter, className, ...props }: BarChartProps) {
  const max = Math.max(1, ...data.map((datum) => datum.value));
  return (
    <div className={cn('w-full', className)} {...props}>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data for this period.</p>
      ) : (
        <>
          <div className="flex items-end gap-1" style={{ height }}>
            {data.map((datum, index) => (
              <div key={index} className="group flex flex-1 flex-col items-center justify-end">
                <div
                  className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary"
                  style={{ height: `${Math.max(2, (datum.value / max) * 100)}%` }}
                  title={`${datum.label}: ${valueFormatter ? valueFormatter(datum.value) : datum.value}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            {data.map((datum, index) => (
              <div key={index} className="flex-1 truncate text-center text-[10px] text-muted-foreground">
                {datum.label}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export interface HBarListProps extends React.HTMLAttributes<HTMLDivElement> {
  data: ChartDatum[];
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
}

function HBarList({ data, valueFormatter, emptyMessage = 'No data.', className, ...props }: HBarListProps) {
  const max = Math.max(1, ...data.map((datum) => datum.value));
  return (
    <div className={cn('space-y-2', className)} {...props}>
      {data.length === 0 ? <p className="text-sm text-muted-foreground">{emptyMessage}</p> : null}
      {data.map((datum, index) => (
        <div key={index} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-foreground">{datum.label}</span>
            <span className="shrink-0 font-medium text-muted-foreground">
              {valueFormatter ? valueFormatter(datum.value) : datum.value}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(datum.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export { BarChart, HBarList };
