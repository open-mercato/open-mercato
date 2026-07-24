"use client"

import * as React from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Sparkline } from './Sparkline'

export type KpiTrend = {
  value: number
  direction: 'up' | 'down' | 'unchanged'
}

export type KpiCardProps = {
  title?: string
  value: number | null
  trend?: KpiTrend | number[]
  delta?: KpiTrend
  comparisonLabel?: string
  loading?: boolean
  error?: string | null
  formatValue?: (value: number) => string
  prefix?: string
  suffix?: string
  className?: string
  headerAction?: React.ReactNode
  footer?: React.ReactNode
  titleClassName?: string
  trendAriaLabel?: string
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

function formatPercentageChange(value: number, unit: string = '%'): string {
  const abs = Math.abs(value)
  const formatted = Number.isInteger(abs) ? String(abs) : abs.toFixed(1)
  return `${formatted}${unit}`
}

type BadgeDeltaProps = {
  direction: 'up' | 'down' | 'unchanged'
  value: number
  unit?: string
  className?: string
  title?: string
}

function BadgeDelta({ direction, value, unit = '%', className = '', title = 'Compared to previous period' }: BadgeDeltaProps) {
  const baseClasses = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium'

  const directionClasses = {
    up: 'bg-status-success-bg text-status-success-text',
    down: 'bg-status-error-bg text-status-error-text',
    unchanged: 'bg-status-neutral-bg text-status-neutral-text',
  }

  const icons = {
    up: <ArrowUp className="h-3 w-3" aria-hidden="true" />,
    down: <ArrowDown className="h-3 w-3" aria-hidden="true" />,
    unchanged: <Minus className="h-3 w-3" aria-hidden="true" />,
  }

  return (
    <span
      className={`${baseClasses} ${directionClasses[direction]}${className ? ` ${className}` : ''}`}
      title={title}
    >
      {icons[direction]}
      {formatPercentageChange(value, unit)}
    </span>
  )
}

export const DeltaBadge = BadgeDelta

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
  footer,
  titleClassName,
  delta,
  trendAriaLabel,
}: KpiCardProps) {
  const hasWrapper = !!title
  const wrapperClass = hasWrapper ? `rounded-lg border bg-card p-4 ${className}` : className
  const sparklineValues = Array.isArray(trend) ? trend : undefined
  const deltaTrend = delta ?? (Array.isArray(trend) ? undefined : trend)

  const headerRow = (title || headerAction) ? (
    <div className="flex items-center justify-between gap-2 mb-2">
      {title && <p className={titleClassName ?? 'text-sm font-medium text-muted-foreground'}>{title}</p>}
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
        <p className="flex items-baseline gap-1.5 text-2xl sm:text-3xl font-semibold tracking-tight text-card-foreground">
          <span>{prefix}{formatValue(value)}</span>
          {suffix ? <span className="text-sm font-medium text-muted-foreground">{suffix}</span> : null}
        </p>
        {deltaTrend && (
          <BadgeDelta direction={deltaTrend.direction} value={deltaTrend.value} />
        )}
      </div>
      {sparklineValues && sparklineValues.length > 0 && (
        <Sparkline
          values={sparklineValues}
          ariaLabel={trendAriaLabel ?? title ?? 'KPI trend'}
          className="mt-3 h-8 w-full text-muted-foreground"
          width={160}
          height={32}
        />
      )}
      {deltaTrend && comparisonLabel && (
        <p className="mt-1 text-xs text-muted-foreground">{comparisonLabel}</p>
      )}
      {footer != null && <div className="mt-3">{footer}</div>}
    </div>
  )
}

export default KpiCard
