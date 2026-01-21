"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LineChart, type LineChartDataItem } from '../../../components/charts/LineChart'
import { DateRangeSelect } from '../../../components/settings/DateRangeSelect'
import { InlineDateRangeSelect } from '../../../components/settings/InlineDateRangeSelect'
import { DEFAULT_SETTINGS, hydrateSettings, type RevenueTrendSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import type { DateRangePreset } from '../../../lib/dateRanges'
import type { DateGranularity } from '../../../lib/aggregations'
import { formatCurrencyCompact } from '../../../lib/formatters'
import { format } from 'date-fns'

async function fetchRevenueTrendData(settings: RevenueTrendSettings): Promise<WidgetDataResponse> {
  const body = {
    entityType: 'sales:orders',
    metric: {
      field: 'grandTotalGrossAmount',
      aggregate: 'sum',
    },
    groupBy: {
      field: 'placedAt',
      granularity: settings.granularity,
    },
    dateRange: {
      field: 'placedAt',
      preset: settings.dateRange,
    },
  }

  const call = await apiCall<WidgetDataResponse>('/api/dashboards/widgets/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!call.ok) {
    const errorMsg = (call.result as Record<string, unknown>)?.error
    throw new Error(typeof errorMsg === 'string' ? errorMsg : 'Failed to fetch revenue trend data')
  }

  return call.result as WidgetDataResponse
}

function formatDate(dateStr: string | null, granularity: DateGranularity): string {
  if (!dateStr) return '--'
  try {
    const date = new Date(dateStr)
    switch (granularity) {
      case 'day':
        return format(date, 'MMM d')
      case 'week':
        return format(date, 'MMM d')
      case 'month':
        return format(date, 'MMM yyyy')
      case 'quarter':
        return format(date, 'QQQ yyyy')
      case 'year':
        return format(date, 'yyyy')
      default:
        return format(date, 'MMM d')
    }
  } catch {
    return String(dateStr)
  }
}

const GRANULARITY_OPTIONS: { value: DateGranularity; labelKey: string }[] = [
  { value: 'day', labelKey: 'dashboards.analytics.granularity.day' },
  { value: 'week', labelKey: 'dashboards.analytics.granularity.week' },
  { value: 'month', labelKey: 'dashboards.analytics.granularity.month' },
  { value: 'quarter', labelKey: 'dashboards.analytics.granularity.quarter' },
  { value: 'year', labelKey: 'dashboards.analytics.granularity.year' },
]

function getAutoGranularity(dateRange: DateRangePreset): DateGranularity {
  switch (dateRange) {
    case 'today':
    case 'yesterday':
    case 'last_7_days':
      return 'day'
    case 'this_week':
    case 'last_week':
    case 'last_30_days':
      return 'day'
    case 'this_month':
    case 'last_month':
    case 'last_90_days':
      return 'week'
    case 'this_quarter':
    case 'last_quarter':
      return 'week'
    case 'this_year':
    case 'last_year':
      return 'month'
    default:
      return 'day'
  }
}

const RevenueTrendWidget: React.FC<DashboardWidgetComponentProps<RevenueTrendSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [data, setData] = React.useState<LineChartDataItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchRevenueTrendData(hydrated)
      const sortedData = [...result.data].sort((a, b) => {
        const aTime = new Date(a.groupKey as string || 0).getTime()
        const bTime = new Date(b.groupKey as string || 0).getTime()
        return aTime - bTime
      })
      const chartData = sortedData.map((item) => ({
        date: formatDate(item.groupKey as string | null, hydrated.granularity),
        Revenue: item.value ?? 0,
      }))
      setData(chartData)
    } catch (err) {
      console.error('Failed to load revenue trend data', err)
      setError(t('dashboards.analytics.widgets.revenueTrend.error', 'Failed to load data'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <DateRangeSelect
          id="revenue-trend-date-range"
          label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
        <div className="space-y-1.5">
          <label
            htmlFor="revenue-trend-granularity"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('dashboards.analytics.settings.granularity', 'Granularity')}
          </label>
          <select
            id="revenue-trend-granularity"
            className="w-full rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.granularity}
            onChange={(e) => onSettingsChange({ ...hydrated, granularity: e.target.value as DateGranularity })}
          >
            {GRANULARITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey, opt.value)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hydrated.showArea}
              onChange={(e) => onSettingsChange({ ...hydrated, showArea: e.target.checked })}
              className="h-4 w-4 rounded border focus:ring-primary"
            />
            {t('dashboards.analytics.settings.showArea', 'Show area fill')}
          </label>
        </div>
      </div>
    )
  }

  const effectiveGranularity = hydrated.granularity === 'day' ? getAutoGranularity(hydrated.dateRange) : hydrated.granularity

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <InlineDateRangeSelect
          value={hydrated.dateRange}
          onChange={(dateRange) => onSettingsChange({ ...hydrated, dateRange, granularity: getAutoGranularity(dateRange) })}
        />
      </div>
      <LineChart
        title={t('dashboards.analytics.widgets.revenueTrend.title', 'Revenue Trend')}
        data={data}
        index="date"
        categories={['Revenue']}
        loading={loading}
        error={error}
        showArea={hydrated.showArea}
        valueFormatter={formatCurrencyCompact}
        colors={['blue']}
        emptyMessage={t('dashboards.analytics.widgets.revenueTrend.empty', 'No revenue data for this period')}
      />
    </div>
  )
}

export default RevenueTrendWidget
