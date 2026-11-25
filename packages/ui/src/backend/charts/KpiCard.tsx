"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { Sparkline, type SparklineBand } from './Sparkline'
import { TileHeader } from './TileHeader'
import { MetricDelta } from './MetricDelta'
import { SignalBadge, type SignalKind } from './SignalBadge'

export type KpiTrend = {
  value: number
  direction: 'up' | 'down' | 'unchanged'
}

export type KpiSignal = {
  variant: StatusBadgeVariant
  label: string
  /** Drives the badge icon; omit for a routine signal. */
  kind?: SignalKind
  description?: string
  band?: SparklineBand
  completeCount?: number
  highlightIndexes?: number[]
}

export type KpiCardProps = {
  title?: string
  /** Rendered inside a tinted circular badge above the title (inline and monochrome in `minimal`). */
  icon?: React.ReactNode
  /** CSS color driving the icon badge tint (e.g. 'var(--chart-1)'); ignored by `minimal`. */
  accent?: string
  /** `minimal` drops the tinted icon badge and the filled delta pill for quiet, dashboard-style tiles. */
  appearance?: 'default' | 'minimal'
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
  /** Process-behaviour classification shown as the primary badge; the delta moves to the muted line. */
  signal?: KpiSignal
  /** Period boundaries printed under the sparkline so the trend has a visible time axis. */
  axisLabels?: { start: string; end: string }
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

function BadgeDelta({ direction, value, unit = '%', className = '', title }: BadgeDeltaProps) {
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
  icon,
  accent,
  appearance = 'default',
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
  signal,
  axisLabels,
}: KpiCardProps) {
  const minimal = appearance === 'minimal'
  // Default tiles are self-contained cards (CRM KPI bars, form analytics); minimal tiles sit inside a host card.
  const wrapperClass = !minimal && title ? cn('rounded-lg border bg-card p-4', className) : className
  const sparklineValues = Array.isArray(trend) ? trend : undefined
  const deltaTrend = delta ?? (Array.isArray(trend) ? undefined : trend)

  const iconBadge = icon ? (
    <span
      className="flex size-10 flex-none items-center justify-center rounded-full bg-muted text-muted-foreground"
      style={accent ? { backgroundColor: `color-mix(in oklab, ${accent} 12%, transparent)`, color: accent } : undefined}
      aria-hidden="true"
    >
      {icon}
    </span>
  ) : null

  const headerRow = minimal
    ? (icon || title || headerAction) ? (
        <TileHeader className="mb-4" title={title ?? ''} icon={icon} action={headerAction} />
      ) : null
    : (iconBadge || title || headerAction) ? (
        <div className="mb-2 space-y-3">
          {(iconBadge || headerAction) ? (
            <div className="flex items-start justify-between gap-2">
              {iconBadge ?? <span />}
              {headerAction}
            </div>
          ) : null}
          {title && <p className={titleClassName ?? 'text-sm font-medium text-muted-foreground'}>{title}</p>}
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
        <p className={minimal ? 'text-3xl tabular-nums tracking-tight text-foreground' : 'text-2xl sm:text-3xl font-semibold tracking-tight text-card-foreground'}>--</p>
        {footer != null && <div className="mt-3">{footer}</div>}
      </div>
    )
  }

  const visibleSignal = signal && (!minimal || signal.variant !== 'neutral') ? signal : null
  return (
    <div className={cn(wrapperClass, minimal && 'flex h-full flex-col')}>
      {headerRow}
      <p className={cn('flex items-baseline gap-1.5 tracking-tight', minimal ? 'text-3xl tabular-nums text-foreground' : 'text-3xl sm:text-4xl font-semibold text-card-foreground')}>
        <span>{prefix}{formatValue(value)}</span>
        {suffix ? <span className="text-sm font-medium text-muted-foreground">{suffix}</span> : null}
      </p>
      {minimal ? (
        (visibleSignal || deltaTrend || comparisonLabel) ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            {visibleSignal ? (
              <SimpleTooltip content={visibleSignal.description ?? visibleSignal.label}>
                <span data-slot="kpi-signal" tabIndex={0} className="inline-flex rounded-full"><SignalBadge variant={visibleSignal.variant} label={visibleSignal.label} kind={visibleSignal.kind} /></span>
              </SimpleTooltip>
            ) : null}
            <MetricDelta
              deltaPct={deltaTrend ? (deltaTrend.direction === 'down' ? -1 : deltaTrend.direction === 'up' ? 1 : 0) * Math.abs(deltaTrend.value) / 100 : null}
              label={comparisonLabel}
            />
          </div>
        ) : null
      ) : signal ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {signal.description ? (
            <SimpleTooltip content={signal.description}>
              <span data-slot="kpi-signal" tabIndex={0} className="inline-flex rounded-full">
                <SignalBadge variant={signal.variant} label={signal.label} kind={signal.kind} />
              </span>
            </SimpleTooltip>
          ) : (
            <span data-slot="kpi-signal" className="inline-flex">
              <SignalBadge variant={signal.variant} label={signal.label} kind={signal.kind} />
            </span>
          )}
          {(deltaTrend || comparisonLabel) && (
            <p className="text-xs text-muted-foreground">
              {deltaTrend ? `${deltaTrend.direction === 'down' ? '-' : deltaTrend.direction === 'up' ? '+' : ''}${formatPercentageChange(deltaTrend.value)} ` : ''}
              {comparisonLabel}
            </p>
          )}
        </div>
      ) : (deltaTrend || comparisonLabel) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {deltaTrend && <BadgeDelta direction={deltaTrend.direction} value={deltaTrend.value} title={comparisonLabel} />}
          {comparisonLabel && <p className="text-xs text-muted-foreground">{comparisonLabel}</p>}
        </div>
      )}
      {sparklineValues && sparklineValues.length > 0 && (minimal ? (
        <div className="mt-auto space-y-1.5 pt-4">
          <div className="h-11 w-full text-chart-1">
            <Sparkline
              values={sparklineValues}
              ariaLabel={trendAriaLabel ?? title ?? 'KPI trend'}
              className="size-full"
              width={240}
              height={44}
              band={signal?.band}
              completeCount={signal?.completeCount}
              highlightIndexes={signal?.highlightIndexes}
            />
          </div>
          {axisLabels ? (
            <div className="flex justify-between text-xs tabular-nums text-muted-foreground" aria-hidden="true"><span>{axisLabels.start}</span><span>{axisLabels.end}</span></div>
          ) : null}
        </div>
      ) : (
        <Sparkline
          values={sparklineValues}
          ariaLabel={trendAriaLabel ?? title ?? 'KPI trend'}
          className="mt-3 h-8 w-full text-muted-foreground"
          width={160}
          height={32}
          band={signal?.band}
          completeCount={signal?.completeCount}
          highlightIndexes={signal?.highlightIndexes}
        />
      ))}
      {footer != null && <div className="mt-3">{footer}</div>}
    </div>
  )
}

export default KpiCard
