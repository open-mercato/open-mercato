"use client"

import * as React from 'react'
import { BarChart3, LineChart as LineChartIcon, TriangleAlert } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { BarChart, DeltaBadge, LineChart } from '@open-mercato/ui/backend/charts'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { usePersistedBooleanFlag } from '@open-mercato/ui/backend/crud/usePersistedBooleanFlag'
import type { DictionaryMap } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { PipelineStageBar } from './kpi/PipelineStageBar'

type DeltaDirection = 'up' | 'down' | 'unchanged'

type SummaryDelta = {
  value: number
  direction: DeltaDirection
}

type MonthlyValuePoint = { period: string; value: number }
type MonthlyCountPoint = { period: string; count: number }

export type DealsSummaryRange = '3m' | '6m' | '12m'
const SUMMARY_RANGES: readonly DealsSummaryRange[] = ['3m', '6m', '12m']
const DEFAULT_RANGE: DealsSummaryRange = '6m'

type ChartType = 'line' | 'bars'

type DealsSummaryResponse = {
  range?: DealsSummaryRange
  baseCurrencyCode: string | null
  convertedAll: boolean
  missingRateCurrencies: string[]
  pipelineValue: {
    value: number
    delta: SummaryDelta
    stages: { stage: string | null; count: number; value: number }[]
    series?: MonthlyValuePoint[]
  }
  activeDeals: {
    value: number
    delta: SummaryDelta
    ownersCount: number
    needAttention: number
    owners: { id: string; count: number }[]
    ownersOverflow: number
    series?: MonthlyCountPoint[]
  }
  wonThisQuarter: {
    value: number
    delta: SummaryDelta
    dealsClosed: number
    avgDeal: number
    series?: MonthlyValuePoint[]
  }
  winRate: {
    value: number
    deltaPp: number
    direction: DeltaDirection
    previousValue: number
    series: { period: string; rate: number }[]
  }
}

export type DealsKpiStripProps = {
  ownerNames: Record<string, string>
  stageDictionary: DictionaryMap
  /** @deprecated No longer rendered since the metric-tab redesign; kept for callers. Remove after one minor cycle. */
  pipelineCount?: number
  className?: string
  /** Bumped by the host when the active org scope changes — forces a KPI refetch so the cards never show another org's data. */
  scopeVersion?: number
  /** Bumped by the host on manual refresh / after mutations — forces a KPI refetch so totals stay in sync with the table. */
  reloadToken?: number
  onNeedsAttentionClick?: () => void
}

type MetricKey = 'pipeline' | 'active' | 'won' | 'winRate'

const METRIC_KEYS: readonly MetricKey[] = ['pipeline', 'active', 'won', 'winRate']

// Values and rates read best as a line, counts and money won per month as bars.
const DEFAULT_CHART_TYPES: Record<MetricKey, ChartType> = {
  pipeline: 'line',
  active: 'bars',
  won: 'bars',
  winRate: 'line',
}

// Indigo line for every chart, matching the top of the stage-breakdown ramp.
const CHART_COLORS = ['var(--chart-indigo)']
const AREA_OPACITY = 0.12
const EXPANDED_STORAGE_KEY = 'om:deals-kpi:expanded'

type MetricView = {
  key: MetricKey
  label: string
  value: string
  suffix: string
  delta: { direction: DeltaDirection; value: number; unit?: string; title: string }
  chartTitle: string
  points: Array<{ period: string; value: number }>
  formatAxis: (value: number) => string
}

function createCompactFormatter(locale: string): (value: number) => string {
  const formatter = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  return (value: number) => formatter.format(value)
}

function createMonthFormatter(locale: string): (period: string) => string {
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
  return (period: string) => {
    const [year, month] = period.split('-').map(Number)
    if (!year || !month) return period
    return formatter.format(new Date(Date.UTC(year, month - 1, 1)))
  }
}

function buildCurrencySuffix(code: string | null, convertedAll: boolean): string {
  if (!code) return convertedAll ? '' : '≈'
  return convertedAll ? code : `≈ ${code}`
}

function KpiDeltaBadge({
  direction,
  value,
  unit,
  title,
}: {
  direction: DeltaDirection
  value: number
  unit?: string
  title: string
}) {
  if (direction === 'unchanged' && value === 0) {
    return (
      <span
        className="inline-flex items-center rounded-md bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-text"
        title={title}
      >
        --
      </span>
    )
  }
  return <DeltaBadge direction={direction} value={value} unit={unit} title={title} />
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Guard the summary payload before rendering: a non-conforming response (an unrelated
// endpoint mock, an error body, or a future contract drift) must surface the error card,
// never crash the whole deals page by dereferencing missing sections/arrays.
function isDealsSummaryResponse(value: unknown): value is DealsSummaryResponse {
  if (!isObject(value)) return false
  const { pipelineValue, activeDeals, wonThisQuarter, winRate } = value
  return (
    isObject(pipelineValue) && Array.isArray(pipelineValue.stages) &&
    isObject(activeDeals) && Array.isArray(activeDeals.owners) &&
    isObject(wonThisQuarter) &&
    isObject(winRate) && Array.isArray(winRate.series)
  )
}

function MetricTab({
  metric,
  active,
  expanded,
  loading,
  onSelect,
  onKeyDown,
  tabRef,
}: {
  metric: MetricView
  active: boolean
  expanded: boolean
  loading: boolean
  onSelect: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  tabRef: (node: HTMLButtonElement | null) => void
}) {
  return (
    <Button
      ref={tabRef}
      type="button"
      variant="ghost"
      role="tab"
      id={`deals-kpi-tab-${metric.key}`}
      aria-selected={active}
      aria-expanded={active && expanded}
      aria-controls="deals-kpi-panel"
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        'relative h-auto min-w-0 flex-col items-start justify-start gap-1 whitespace-normal rounded-none bg-card px-4 py-3 text-left font-normal',
        'hover:bg-muted/40 focus-visible:bg-muted/40',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <span className="text-xs">{metric.label}</span>
      <span className={cn('flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 transition-opacity', loading && 'opacity-50')}>
        <span className="text-xl font-light tracking-tight text-foreground sm:text-2xl">
          {metric.value}
          {metric.suffix ? <span className="ml-1 text-xs font-normal text-muted-foreground">{metric.suffix}</span> : null}
        </span>
        <KpiDeltaBadge {...metric.delta} />
      </span>
      {active && expanded ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" /> : null}
    </Button>
  )
}

export function DealsKpiStrip({
  ownerNames,
  stageDictionary,
  className,
  scopeVersion,
  reloadToken,
  onNeedsAttentionClick,
}: DealsKpiStripProps) {
  const t = useT()
  const locale = useLocale()
  const formatCompact = React.useMemo(() => createCompactFormatter(locale), [locale])
  const formatMonth = React.useMemo(() => createMonthFormatter(locale), [locale])
  const pluralCat = React.useCallback((count: number): string => {
    try {
      return new Intl.PluralRules(locale).select(count)
    } catch {
      return count === 1 ? 'one' : 'other'
    }
  }, [locale])
  const pf = React.useCallback((base: string, count: number): string => {
    const cat = pluralCat(count)
    const key = `${base}.${cat}`
    const out = t(key, { count })
    return out === key ? t(`${base}.other`, { count }) : out
  }, [t, pluralCat])
  const [data, setData] = React.useState<DealsSummaryResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [retryToken, setRetryToken] = React.useState(0)
  const [activeMetric, setActiveMetric] = React.useState<MetricKey>('pipeline')
  const { value: expanded, setValue: setExpanded } = usePersistedBooleanFlag(EXPANDED_STORAGE_KEY, false)
  const [range, setRange] = React.useState<DealsSummaryRange>(DEFAULT_RANGE)
  const [chartTypes, setChartTypes] = React.useState<Record<MetricKey, ChartType>>(DEFAULT_CHART_TYPES)
  const tabRefs = React.useRef<Partial<Record<MetricKey, HTMLButtonElement | null>>>({})
  const previousScopeVersionRef = React.useRef(scopeVersion)

  const retry = React.useCallback(() => {
    setRetryToken((token) => token + 1)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const scopeChanged = previousScopeVersionRef.current !== scopeVersion
    previousScopeVersionRef.current = scopeVersion
    if (scopeChanged) setData(null)
    setLoading(true)
    setError(null)
    apiCall<DealsSummaryResponse>(`/api/customers/deals/summary?range=${encodeURIComponent(range)}`)
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !isDealsSummaryResponse(call.result)) {
          setError(t('customers.deals.list.kpi.error'))
          return
        }
        setData(call.result)
      })
      .catch(() => {
        if (cancelled) return
        setError(t('customers.deals.list.kpi.error'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [t, scopeVersion, reloadToken, retryToken, range])

  const handleTabKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = METRIC_KEYS.indexOf(activeMetric)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % METRIC_KEYS.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + METRIC_KEYS.length) % METRIC_KEYS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = METRIC_KEYS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextKey = METRIC_KEYS[nextIndex]!
    setActiveMetric(nextKey)
    tabRefs.current[nextKey]?.focus()
  }, [activeMetric])

  // A click on the active metric folds the panel away; any other metric opens it.
  const selectMetric = React.useCallback((key: MetricKey) => {
    if (key === activeMetric) {
      setExpanded(!expanded)
      return
    }
    setActiveMetric(key)
    setExpanded(true)
  }, [activeMetric, expanded, setExpanded])

  const wrapperClassName = cn('space-y-2', className)
  // Same horizontal inset as the DataTable container below, so both edges line up.
  const cardClassName = 'mx-1 overflow-hidden rounded-lg border border-border bg-card sm:mx-2'
  const headerClassName = 'flex flex-col xl:flex-row'
  const tabListClassName = 'grid min-w-0 flex-1 grid-cols-2 gap-px bg-border xl:grid-cols-4'
  const activeChartType = chartTypes[activeMetric]
  // A failed refetch leaves the previous window's numbers on screen, so the control names that window.
  const displayedRange = error && data?.range ? data.range : range
  const selectRange = (next: string) => {
    if (next === range) {
      retry()
      return
    }
    setRange(next as DealsSummaryRange)
  }
  const periodControl = (
    <div className="flex shrink-0 items-center justify-end border-t border-border px-3 py-2 xl:border-l xl:border-t-0">
      <SegmentedControl
        size="sm"
        value={displayedRange}
        onValueChange={selectRange}
        aria-label={t('customers.deals.list.kpi.rangeLabel')}
      >
        {SUMMARY_RANGES.map((option) => (
          <SegmentedControlItem key={option} value={option}>
            {t(`customers.deals.list.kpi.range.${option}`)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  )
  const controls = (
    <div className="flex items-center justify-end gap-2 px-3 pb-1 pt-3">
      <SegmentedControl
        size="sm"
        value={activeChartType}
        onValueChange={(next) => setChartTypes((current) => ({ ...current, [activeMetric]: next as ChartType }))}
        aria-label={t('customers.deals.list.kpi.chartTypeLabel')}
      >
        <SegmentedControlItem value="line" aria-label={t('customers.deals.list.kpi.chartLine')}>
          <LineChartIcon className="size-4" aria-hidden />
        </SegmentedControlItem>
        <SegmentedControlItem value="bars" aria-label={t('customers.deals.list.kpi.chartBars')}>
          <BarChart3 className="size-4" aria-hidden />
        </SegmentedControlItem>
      </SegmentedControl>
    </div>
  )
  const metricLabels: Record<MetricKey, string> = {
    pipeline: t('customers.deals.list.kpi.pipelineValue'),
    active: t('customers.deals.list.kpi.activeDeals'),
    won: t('customers.deals.list.kpi.wonThisQuarter'),
    winRate: t('customers.deals.list.kpi.winRate'),
  }

  if (loading && !data) {
    return (
      <div className={wrapperClassName}>
        <div className={cardClassName}>
          <div className={headerClassName}>
            <div className={tabListClassName}>
              {METRIC_KEYS.map((key) => (
                <div key={key} className="flex flex-col gap-1.5 bg-card px-4 py-3">
                  <span className="text-xs text-muted-foreground">{metricLabels[key]}</span>
                  <Spinner className="h-5 w-5 text-muted-foreground" />
                </div>
              ))}
            </div>
            {periodControl}
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    const errorMessage = error ?? t('customers.deals.list.kpi.error')
    return (
      <div className={wrapperClassName}>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{errorMessage}</p>
          <Button type="button" variant="destructive-outline" size="sm" onClick={retry}>
            {t('customers.deals.list.kpi.retry')}
          </Button>
        </div>
      </div>
    )
  }

  const currencySuffix = buildCurrencySuffix(data.baseCurrencyCode, data.convertedAll)
  const unassignedLabel = t('customers.deals.list.kpi.unassignedStage')
  const deltaTooltip = t('customers.deals.list.kpi.deltaTooltip')
  const deltaUnavailableTooltip = t('customers.deals.list.kpi.deltaUnavailable')
  const unknownOwner = t('customers.deals.list.unknownOwner')
  const currencyHint = !data.convertedAll
    ? data.baseCurrencyCode
      ? t('customers.deals.list.kpi.currencyApproxMissing', {
          currencies: data.missingRateCurrencies.length ? data.missingRateCurrencies.join(', ') : currencySuffix,
        })
      : t('customers.deals.list.kpi.currencyApproxNoBase')
    : null
  const attentionLabel = pf('customers.deals.list.kpi.frag.needAttention', data.activeDeals.needAttention)
  const withCurrency = (value: number) => `${formatCompact(value)}${currencySuffix ? ` ${currencySuffix}` : ''}`
  const deltaTitle = (delta: SummaryDelta) => (delta.direction === 'unchanged' && delta.value === 0 ? deltaUnavailableTooltip : deltaTooltip)
  const toPoints = (points: Array<{ period: string; value: number }>) => points.map((point) => ({ period: formatMonth(point.period), value: point.value }))

  const metrics: Record<MetricKey, MetricView> = {
    pipeline: {
      key: 'pipeline',
      label: metricLabels.pipeline,
      value: formatCompact(data.pipelineValue.value),
      suffix: currencySuffix,
      delta: { ...data.pipelineValue.delta, title: deltaTitle(data.pipelineValue.delta) },
      chartTitle: t('customers.deals.list.kpi.chart.pipeline'),
      points: toPoints(data.pipelineValue.series ?? []),
      formatAxis: formatCompact,
    },
    active: {
      key: 'active',
      label: metricLabels.active,
      value: formatCompact(data.activeDeals.value),
      suffix: '',
      delta: { ...data.activeDeals.delta, title: deltaTitle(data.activeDeals.delta) },
      chartTitle: t('customers.deals.list.kpi.chart.active'),
      points: toPoints((data.activeDeals.series ?? []).map((point) => ({ period: point.period, value: point.count }))),
      formatAxis: (value) => formatCompact(value),
    },
    won: {
      key: 'won',
      label: metricLabels.won,
      value: formatCompact(data.wonThisQuarter.value),
      suffix: currencySuffix,
      delta: { ...data.wonThisQuarter.delta, title: deltaTitle(data.wonThisQuarter.delta) },
      chartTitle: t('customers.deals.list.kpi.chart.won'),
      points: toPoints(data.wonThisQuarter.series ?? []),
      formatAxis: formatCompact,
    },
    winRate: {
      key: 'winRate',
      label: metricLabels.winRate,
      value: formatCompact(data.winRate.value),
      suffix: '%',
      delta: {
        direction: data.winRate.direction,
        value: Math.abs(data.winRate.deltaPp),
        unit: 'pp',
        title: data.winRate.previousValue === 0 ? deltaUnavailableTooltip : deltaTooltip,
      },
      chartTitle: t('customers.deals.list.kpi.chart.winRate'),
      points: toPoints(data.winRate.series.map((point) => ({ period: point.period, value: Math.round(point.rate * 100) }))),
      formatAxis: (value) => `${Math.round(value)}%`,
    },
  }
  const current = metrics[activeMetric]

  const context: Record<MetricKey, React.ReactNode> = {
    pipeline: data.pipelineValue.stages.some((stage) => stage.count > 0) || currencyHint ? (
      <div className="space-y-3">
        <PipelineStageBar
          stages={data.pipelineValue.stages}
          stageDictionary={stageDictionary}
          unassignedLabel={unassignedLabel}
          formatValue={withCurrency}
          formatCount={(count) => pf('customers.deals.list.kpi.frag.deals', count)}
          otherLabel={(count) => t('customers.deals.list.kpi.otherStages', { count })}
        />
        {currencyHint ? <p className="text-xs text-muted-foreground">{currencyHint}</p> : null}
      </div>
    ) : null,
    active: data.activeDeals.needAttention > 0 || data.activeDeals.owners.length > 0 ? (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        {data.activeDeals.needAttention > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <TriangleAlert className="size-3.5 shrink-0 text-status-warning-icon" aria-hidden />
            {onNeedsAttentionClick ? (
              <Button
                type="button"
                variant="link"
                size="2xs"
                className="h-auto p-0 text-xs font-medium text-foreground"
                onClick={onNeedsAttentionClick}
              >
                {attentionLabel}
              </Button>
            ) : (
              <span className="font-medium text-foreground">{attentionLabel}</span>
            )}
          </span>
        ) : null}
        {data.activeDeals.owners.length > 0 ? (
          <AvatarStack max={4} size="sm" overflowCount={data.activeDeals.ownersOverflow}>
            {data.activeDeals.owners.map((owner) => {
              const ownerLabel = ownerNames[owner.id]?.trim() || unknownOwner
              return <Avatar key={owner.id} label={ownerLabel} size="sm" />
            })}
          </AvatarStack>
        ) : null}
      </div>
    ) : null,
    won: data.wonThisQuarter.dealsClosed > 0 || currencyHint ? (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        {data.wonThisQuarter.dealsClosed > 0 ? (
          <span>
            {t('customers.deals.list.kpi.avgDealLabel')}{' '}
            <span className="font-medium text-foreground">{withCurrency(data.wonThisQuarter.avgDeal)}</span>
          </span>
        ) : null}
        {currencyHint ? <span>{currencyHint}</span> : null}
      </div>
    ) : null,
    winRate: null,
  }

  return (
    <div className={wrapperClassName}>
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs text-destructive">{error}</p>
          <Button type="button" variant="destructive-outline" size="2xs" onClick={retry}>
            {t('customers.deals.list.kpi.retry')}
          </Button>
        </div>
      ) : null}
      <div className={cardClassName} aria-busy={loading}>
        <div className={cn(headerClassName, expanded && 'border-b border-border')}>
          <div role="tablist" aria-label={t('customers.deals.list.kpi.metricTabs')} className={tabListClassName}>
            {METRIC_KEYS.map((key) => (
              <MetricTab
                key={key}
                metric={metrics[key]}
                active={key === activeMetric}
                expanded={expanded}
                loading={loading}
                onSelect={() => selectMetric(key)}
                onKeyDown={handleTabKeyDown}
                tabRef={(node) => { tabRefs.current[key] = node }}
              />
            ))}
          </div>
          {periodControl}
        </div>
        {expanded ? (
        <div
          role="tabpanel"
          id="deals-kpi-panel"
          aria-labelledby={`deals-kpi-tab-${activeMetric}`}
          className={cn('grid grid-cols-1', context[activeMetric] ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : null)}
        >
          <div className="flex min-w-0 flex-col">
            {controls}
            <div className="relative mx-3 mb-3 mt-2 min-h-44 flex-1">
            {activeChartType === 'bars' ? (
              <BarChart
                bare
                loading={loading}
                showLegend={false}
                animate={false}
                accessibilityLayer={false}
                heightClassName="absolute inset-0"
                data={current.points}
                index="period"
                categories={['value']}
                categoryLabels={{ value: current.chartTitle }}
                colors={CHART_COLORS}
                valueFormatter={current.formatAxis}
                emptyMessage={t('customers.deals.list.kpi.chartEmpty')}
              />
            ) : (
              <LineChart
                bare
                loading={loading}
                showArea
                areaOpacity={AREA_OPACITY}
                showLegend={false}
                curveType="linear"
                animate={false}
                accessibilityLayer={false}
                heightClassName="absolute inset-0"
                data={current.points}
                index="period"
                categories={['value']}
                categoryLabels={{ value: current.chartTitle }}
                colors={CHART_COLORS}
                valueFormatter={current.formatAxis}
                emptyMessage={t('customers.deals.list.kpi.chartEmpty')}
              />
            )}
            </div>
          </div>
          {context[activeMetric] ? (
            <div className="border-t border-border px-4 py-3 lg:border-l lg:border-t-0">{context[activeMetric]}</div>
          ) : null}
        </div>
        ) : null}
      </div>
    </div>
  )
}

export default DealsKpiStrip
