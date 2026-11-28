"use client"

import * as React from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

export type MetricDeltaProps = {
  /** Relative change as a fraction (0.12 = +12%); `null` hides the arrow and percent. */
  deltaPct: number | null
  /** Muted text after the percent, e.g. "vs previous period". */
  label?: string | null
  locale?: string
  className?: string
}

/** Computes the relative change between two values, or `null` when the previous value cannot anchor a percent. */
export function relativeChange(value: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous) || previous === 0) return null
  return (value - previous) / Math.abs(previous)
}

/**
 * The one way the dashboard shows a change: a direction arrow and signed percent in the status colour,
 * followed by a muted comparison label. Used by KPI tiles, the brief and the metric detail views.
 */
export function MetricDelta({ deltaPct, label, locale, className }: MetricDeltaProps) {
  if (deltaPct === null && !label) return null
  const direction = deltaPct === null ? null : deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat'
  const percent = deltaPct === null
    ? null
    : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(deltaPct)
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground', className)} data-slot="metric-delta">
      {direction ? (
        <span className={cn('inline-flex items-center gap-0.5 tabular-nums', direction === 'up' ? 'text-status-success-text' : direction === 'down' ? 'text-status-error-text' : 'text-foreground')}>
          {direction === 'up' ? <ArrowUp className="size-3.5" aria-hidden="true" /> : direction === 'down' ? <ArrowDown className="size-3.5" aria-hidden="true" /> : <Minus className="size-3.5" aria-hidden="true" />}
          {percent}
        </span>
      ) : null}
      {label ? <span>{label}</span> : null}
    </span>
  )
}

export default MetricDelta
