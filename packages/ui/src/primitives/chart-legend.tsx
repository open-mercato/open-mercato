import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export type ChartLegendColor = 'gray' | 'light-gray' | 'blue' | 'orange' | 'red' | 'green' | 'yellow' | 'purple' | 'sky' | 'pink' | 'teal'

const colors: Record<ChartLegendColor, string> = {
  gray: 'bg-chart-legend-gray', 'light-gray': 'bg-chart-legend-light-gray', blue: 'bg-status-info-icon',
  orange: 'bg-status-warning-icon', red: 'bg-status-error-icon', green: 'bg-status-success-icon',
  yellow: 'bg-badge-yellow-solid', purple: 'bg-badge-purple-solid', sky: 'bg-badge-sky-solid', pink: 'bg-key-icon-pink-icon', teal: 'bg-badge-teal-solid',
}

export type ChartLegendDotProps = React.HTMLAttributes<HTMLSpanElement> & { color?: ChartLegendColor; size?: 16 | 20 }

export function ChartLegendDot({ color = 'gray', size = 16, className, ...props }: ChartLegendDotProps) {
  return <span data-slot="chart-legend-dot" data-color={color} data-size={size} aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center', size === 16 ? 'size-4' : 'size-5', className)} {...props}>
    <span className={cn('size-3 rounded-full border-2 border-background shadow-sm', colors[color])} />
  </span>
}

export function ChartLegend({ color = 'gray', disabled = false, children, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { color?: ChartLegendColor; disabled?: boolean }) {
  return <span data-slot="chart-legend" data-disabled={disabled} aria-disabled={disabled || undefined} className={cn('inline-flex items-center gap-1 text-xs font-medium leading-4', disabled ? 'text-text-disabled' : 'text-muted-foreground', className)} {...props}>
    <ChartLegendDot color={disabled ? 'light-gray' : color} />{children}
  </span>
}
