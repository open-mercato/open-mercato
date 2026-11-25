"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export type BreakdownListRow = {
  key?: string
  label: string
  value: number
}

export type BreakdownListProps = {
  rows: BreakdownListRow[]
  /** Formats a row's value; defaults to a locale-aware plain number. */
  formatValue?: (value: number) => string
  locale?: string
  /** Rows arrive in the order to show; set to sort by value, largest first. */
  sort?: boolean
  className?: string
}

/**
 * Groups as rows: label, value, share of the total and a bar scaled to the largest group. Reads better
 * than a pie or donut once there are five or more groups, and takes any number of them.
 */
export function BreakdownList({ rows, formatValue, locale, sort = true, className }: BreakdownListProps) {
  const ordered = React.useMemo(() => (sort ? [...rows].sort((left, right) => right.value - left.value) : rows), [rows, sort])
  const total = ordered.reduce((sum, row) => sum + row.value, 0)
  const max = ordered.reduce((largest, row) => Math.max(largest, row.value), 0)
  const format = formatValue ?? ((value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value))
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  return (
    <ul className={cn('space-y-2', className)} data-slot="breakdown-list">
      {ordered.map((row, index) => (
        <li key={row.key || `${row.label}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-base text-foreground" title={row.label}>{row.label}</span>
          <span className="text-base tabular-nums text-foreground">
            {format(row.value)}
            {total > 0 ? <span className="ml-2 text-xs text-muted-foreground">{percent.format(row.value / total)}</span> : null}
          </span>
          <div className="col-span-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-chart-1" style={{ width: `${max > 0 ? Math.max(2, Math.round((row.value / max) * 100)) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default BreakdownList
