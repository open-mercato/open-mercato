"use client"

import * as React from 'react'
import { format } from 'date-fns/format'
import type { DashboardDateRangeCompare, DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { DeltaBadge } from '@open-mercato/ui/backend/charts'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  DateRangeSelect,
  resolveDateRange,
  type DateRangePreset,
} from '@open-mercato/ui/backend/date-range'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { DEFAULT_SETTINGS, hydrateSettings, type AiInsightsSettings } from './config'
import { formatCurrency, formatCurrencyWithDecimals } from '../../../lib/formatters'
import type { InsightMetric, InsightsResult } from '../../../lib/insights'

type ActiveRange = {
  from: string
  to: string
  compare: DashboardDateRangeCompare
}

const FALLBACK_PRESET: DateRangePreset = 'last_30_days'

const METRIC_FALLBACKS: Record<InsightMetric['key'], string> = {
  revenue: 'Revenue',
  orders: 'Orders',
  aov: 'Average order value',
  new_customers: 'New customers',
}

function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function resolvePresetRange(preset: DateRangePreset): ActiveRange {
  const range = resolveDateRange(preset)
  return {
    from: toIsoDate(range.start),
    to: toIsoDate(range.end),
    compare: 'previous_period',
  }
}

function resolveActiveRange(
  settings: AiInsightsSettings,
  context: DashboardWidgetComponentProps<AiInsightsSettings>['context'],
): ActiveRange {
  if (settings.dateRangeMode === 'global' && context.dateRange) {
    return {
      from: context.dateRange.from,
      to: context.dateRange.to,
      compare: context.dateRange.compare,
    }
  }
  return resolvePresetRange((settings.dateRangePreset as DateRangePreset | null) ?? FALLBACK_PRESET)
}

function formatMetricValue(metric: InsightMetric, value: number): string {
  if (metric.key === 'revenue') return formatCurrency(value)
  if (metric.key === 'aov') return formatCurrencyWithDecimals(value)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function deltaDirection(deltaPct: number): 'up' | 'down' | 'unchanged' {
  if (deltaPct > 0) return 'up'
  if (deltaPct < 0) return 'down'
  return 'unchanged'
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

async function fetchInsights(range: ActiveRange): Promise<InsightsResult> {
  const params = new URLSearchParams({
    from: range.from,
    to: range.to,
    compare: range.compare,
  })
  const call = await apiCall<InsightsResult>(`/api/dashboards/insights?${params.toString()}`, {
    method: 'GET',
  })
  if (!call.ok || !call.result) {
    throw new Error(`Failed to load insights (${call.status})`)
  }
  return call.result
}

function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3" role="status" aria-label={label}>
      {[0, 1, 2].map((idx) => (
        <div key={idx} className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-5 w-32 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

const AiInsightsWidgetClient: React.FC<DashboardWidgetComponentProps<AiInsightsSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  context,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const activeRange = React.useMemo(() => resolveActiveRange(hydrated, context), [hydrated, context])
  const [data, setData] = React.useState<InsightsResult | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const showPresetControl = hydrated.dateRangeMode === 'custom' || !context.dateRange
  const selectedPreset = (hydrated.dateRangePreset as DateRangePreset | null) ?? FALLBACK_PRESET

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      setData(await fetchInsights(activeRange))
    } catch (err) {
      console.error('Failed to load AI insights', err)
      setError(t('dashboards.widgets.aiInsights.error.load', 'Failed to load insights'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [activeRange, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor="ai-insights-date-range-mode" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('dashboards.widgets.aiInsights.settings.dateRangeMode', 'Date range source')}
          </label>
          <Select
            value={hydrated.dateRangeMode}
            onValueChange={(dateRangeMode) => onSettingsChange({
              ...hydrated,
              dateRangeMode: dateRangeMode as 'global' | 'custom',
            })}
          >
            <SelectTrigger id="ai-insights-date-range-mode" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">{t('dashboards.widgets.aiInsights.settings.global', 'Dashboard range')}</SelectItem>
              <SelectItem value="custom">{t('dashboards.widgets.aiInsights.settings.custom', 'Custom range')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showPresetControl ? (
          <DateRangeSelect
            id="ai-insights-date-range"
            label={t('dashboards.widgets.aiInsights.settings.dateRangePreset', 'Date range')}
            value={selectedPreset}
            onChange={(dateRangePreset) => onSettingsChange({ ...hydrated, dateRangePreset })}
          />
        ) : null}
      </div>
    )
  }

  if (loading) {
    return <LoadingSkeleton label={t('dashboards.widgets.aiInsights.loading', 'Loading insights')} />
  }

  if (error) {
    return (
      <ErrorMessage
        label={error}
        action={(
          <Button type="button" size="sm" variant="outline" onClick={() => refresh().catch(() => {})}>
            {t('dashboards.widgets.aiInsights.retry', 'Retry')}
          </Button>
        )}
      />
    )
  }

  if (!data || data.metrics.length === 0) {
    return (
      <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        {t('dashboards.widgets.aiInsights.empty', 'No insights are available for this range.')}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {data.metrics.map((metric) => (
          <div key={metric.key} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {t(metric.label, METRIC_FALLBACKS[metric.key])}
              </p>
              {metric.previousValue !== null ? (
                <p className="text-xs text-muted-foreground">
                  {t('dashboards.widgets.aiInsights.previousValue', 'Previous: {value}', {
                    value: formatMetricValue(metric, metric.previousValue),
                  })}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-semibold text-foreground">{formatMetricValue(metric, metric.value)}</span>
              {metric.deltaPct !== null ? (
                <DeltaBadge
                  direction={deltaDirection(metric.deltaPct)}
                  value={metric.deltaPct * 100}
                  title={t('dashboards.widgets.aiInsights.deltaTitle', 'Compared with the selected window')}
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('dashboards.widgets.aiInsights.noComparison', 'No comparison')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {data.digest ? (
        <div className="space-y-2">
          <div>
            <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground">
              {t('dashboards.widgets.aiInsights.aiLabel', 'AI-generated')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('dashboards.widgets.aiInsights.generatedAt', 'Generated {date}', {
                date: formatGeneratedAt(data.digest.generatedAt),
              })}
            </p>
          </div>
          <ul className="space-y-1 text-sm text-foreground">
            {data.digest.bullets.map((bullet, idx) => (
              <li key={`${idx}-${bullet}`} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-brand-violet" aria-hidden="true" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!data.aiAvailable ? (
        <p className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t('dashboards.widgets.aiInsights.noProvider', 'Connect an AI provider to show a generated digest.')}
        </p>
      ) : null}
    </div>
  )
}

export default AiInsightsWidgetClient
