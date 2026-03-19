"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export type KpiTrend = {
  value: number
  direction: 'up' | 'down' | 'unchanged'
}

export type KpiCardProps = {
  title?: string
  value: number | null
  trend?: KpiTrend
  comparisonLabel?: string
  loading?: boolean
  error?: string | null
  formatValue?: (value: number) => string
  prefix?: string
  suffix?: string
  className?: string
  headerAction?: React.ReactNode
}

function defaultFormatValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatPercentageChange(value: number): string {
  const formatted = Math.abs(value).toFixed(1)
  return `${formatted}%`
}

type BadgeDeltaProps = {
  direction: 'up' | 'down' | 'unchanged'
  value: number
}

function BadgeDelta({ direction, value }: BadgeDeltaProps) {
  const baseClasses = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium'

  const directionClasses = {
    up: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    down: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    unchanged: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  }

  const icons = {
    up: (
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    ),
    down: (
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    ),
    unchanged: (
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
      </svg>
    ),
  }

  return (
    <span
      className={`${baseClasses} ${directionClasses[direction]}`}
      title="Compared to previous period"
    >
      {icons[direction]}
      {formatPercentageChange(value)}
    </span>
  )
}

export function KpiCard({
  title,
  value,
  trend,
  comparisonLabel,
  loading,
  error,
  formatValue = defaultFormatValue,
  prefix = '',
  suffix = '',
  className = '',
  headerAction,
}: KpiCardProps) {
  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className

  const headerRow = (title || headerAction) ? (
    <div className="flex items-center justify-between gap-2 mb-2">
      {title && <p className="text-sm font-medium text-muted-foreground">{title}</p>}
      {headerAction}
    </div>
  ) : null

  if (error) {
    return (
      <div className={wrapperClass}>
        {headerRow}
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={wrapperClass}>
        {headerRow}
        <div className="flex items-center justify-center py-4">
          <Spinner className="h-6 w-6 text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (value === null) {
    return (
      <div className={wrapperClass}>
        {headerRow}
        <p className="text-2xl sm:text-3xl font-semibold tracking-tight text-card-foreground">--</p>
      </div>
    )
  }

  return (
    <div className={wrapperClass}>
      {headerRow}
      <div className="flex items-baseline gap-3">
        <p className="text-2xl sm:text-3xl font-semibold tracking-tight text-card-foreground">
          {prefix}
          {formatValue(value)}
          {suffix}
        </p>
        {trend && (
          <BadgeDelta direction={trend.direction} value={trend.value} />
        )}
      </div>
      {trend && comparisonLabel && (
        <p className="mt-1 text-xs text-muted-foreground">{comparisonLabel}</p>
      )}
    </div>
  )
}

export default KpiCard
