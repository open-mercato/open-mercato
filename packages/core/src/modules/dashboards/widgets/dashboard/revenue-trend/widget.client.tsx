"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useWidgetData, type WidgetDataFetcher } from '@open-mercato/ui/backend/dashboard/widgetData'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { LineChart, type LineChartDataItem } from '@open-mercato/ui/backend/charts'
import {
  DateRangeSelect,
  InlineDateRangeSelect,
  type DateRangePreset,
} from '@open-mercato/ui/backend/date-range'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import type { DateGranularity } from '@open-mercato/shared/modules/analytics'
import { DEFAULT_SETTINGS, hydrateSettings, type RevenueTrendSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import { formatCurrencyCompact } from '../../../lib/formatters'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'revenue-trend' })

async function fetchRevenueTrendData(
  settings: RevenueTrendSettings,
  context: DashboardWidgetComponentProps<RevenueTrendSettings>['context'],
  fetchWidgetData: WidgetDataFetcher,
): Promise<WidgetDataResponse> {
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
    dateRange: settings.dateRangeMode === 'global' && context.dateRange
      ? { field: 'placedAt', from: context.dateRange.from, to: context.dateRange.to }
      : { field: 'placedAt', preset: settings.dateRange },
  }

  return fetchWidgetData<WidgetDataResponse>(body)
}

function formatDate(dateStr: string | null, granularity: DateGranularity, locale?: string): string {
  if (!dateStr) return '--'
  try {
    const date = new Date(dateStr)
    const localeStr = locale ?? undefined
    switch (granularity) {
      case 'day':
      case 'week':
        return date.toLocaleDateString(localeStr, { month: 'short', day: 'numeric' })
      case 'month':
        return date.toLocaleDateString(localeStr, { month: 'short', year: 'numeric' })
      case 'quarter': {
        const quarter = Math.floor(date.getMonth() / 3) + 1
        return `Q${quarter} ${date.getFullYear()}`
      }
      case 'year':
        return date.toLocaleDateString(localeStr, { year: 'numeric' })
      default:
        return date.toLocaleDateString(localeStr, { month: 'short', day: 'numeric' })
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
  context,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const locale = useLocale()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [data, setData] = React.useState<LineChartDataItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchWidgetData = useWidgetData()
  const showDateRangeControls = hydrated.dateRangeMode === 'custom' || !context.dateRange
  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchRevenueTrendData(hydrated, context, fetchWidgetData)
      const sortedData = [...result.data].sort((a, b) => {
        const aTime = new Date(a.groupKey as string || 0).getTime()
        const bTime = new Date(b.groupKey as string || 0).getTime()
        return aTime - bTime
      })
      const chartData = sortedData.map((item) => ({
        date: formatDate(item.groupKey as string | null, hydrated.granularity, locale),
        Revenue: item.value ?? 0,
      }))
      setData(chartData)
    } catch (err) {
      logger.error('Failed to load revenue trend data', { err })
      setError(t('dashboards.analytics.widgets.revenueTrend.error', 'Failed to load data'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [context, hydrated, fetchWidgetData, locale, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor="revenue-trend-date-range-mode" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('dashboards.widgets.dateRange.mode.label', 'Date range source')}
          </label>
          <Select
            value={hydrated.dateRangeMode}
            onValueChange={(dateRangeMode) => onSettingsChange({ ...hydrated, dateRangeMode: dateRangeMode as 'global' | 'custom' })}
          >
            <SelectTrigger id="revenue-trend-date-range-mode" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">{t('dashboards.widgets.dateRange.mode.global', 'Dashboard range')}</SelectItem>
              <SelectItem value="custom">{t('dashboards.widgets.dateRange.mode.custom', 'Custom range')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showDateRangeControls && (
          <DateRangeSelect
            id="revenue-trend-date-range"
            label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
            value={hydrated.dateRange}
            onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
          />
        )}
        <div className="space-y-1.5">
          <label
            htmlFor="revenue-trend-granularity"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('dashboards.analytics.settings.granularity', 'Granularity')}
          </label>
          <Select
            value={hydrated.granularity}
            onValueChange={(value) => onSettingsChange({ ...hydrated, granularity: value as DateGranularity })}
          >
            <SelectTrigger id="revenue-trend-granularity" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRANULARITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey, opt.value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CheckboxField
          id="revenue-trend-show-area"
          checked={hydrated.showArea}
          onCheckedChange={(checked) => onSettingsChange({ ...hydrated, showArea: checked === true })}
          label={t('dashboards.analytics.settings.showArea', 'Show area fill')}
        />
      </div>
    )
  }

  return (
    <div>
      {showDateRangeControls && (
        <div className="mb-2 flex justify-end">
          <InlineDateRangeSelect
            value={hydrated.dateRange}
            onChange={(dateRange) => onSettingsChange({ ...hydrated, dateRange, granularity: getAutoGranularity(dateRange) })}
          />
        </div>
      )}
      <LineChart
        data={data}
        index="date"
        categories={['Revenue']}
        categoryLabels={{ Revenue: t('dashboards.analytics.widgets.topCustomers.column.revenue', 'Revenue') }}
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
