"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useWidgetData, type WidgetDataFetcher } from '@open-mercato/ui/backend/dashboard/widgetData'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart, type BarChartDataItem } from '@open-mercato/ui/backend/charts'
import { DateRangeSelect, InlineDateRangeSelect, type DateRangePreset } from '@open-mercato/ui/backend/date-range'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { DEFAULT_SETTINGS, hydrateSettings, type TopProductsSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import { formatCurrencyCompact } from '../../../lib/formatters'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'top-products' })

async function fetchTopProductsData(
  settings: TopProductsSettings,
  context: DashboardWidgetComponentProps<TopProductsSettings>['context'],
  fetchWidgetData: WidgetDataFetcher,
): Promise<WidgetDataResponse> {
  const body = {
    entityType: 'sales:order_lines',
    metric: {
      field: 'totalGrossAmount',
      aggregate: 'sum',
    },
    groupBy: {
      field: 'productId',
      limit: settings.limit,
      resolveLabels: true,
    },
    dateRange: settings.dateRangeMode === 'global' && context.dateRange
      ? { field: 'createdAt', from: context.dateRange.from, to: context.dateRange.to }
      : { field: 'createdAt', preset: settings.dateRange },
  }

  return fetchWidgetData<WidgetDataResponse>(body)
}

function truncateLabel(
  label: unknown,
  t: (key: string, fallback: string) => string,
  maxLength: number = 20
): string {
  if (label == null || label === '') return t('dashboards.analytics.labels.unknownProduct', 'Unknown Product')
  const labelStr = String(label)
  // Check for UUID-like strings or meaningless values
  if (labelStr === '0' || labelStr === 'null' || labelStr === 'undefined') {
    return t('dashboards.analytics.labels.unknownProduct', 'Unknown Product')
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(labelStr)) {
    return t('dashboards.analytics.labels.unnamedProduct', 'Unnamed Product')
  }
  if (labelStr.length <= maxLength) return labelStr
  return labelStr.slice(0, maxLength - 3) + '...'
}

const TopProductsWidget: React.FC<DashboardWidgetComponentProps<TopProductsSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  context,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [data, setData] = React.useState<BarChartDataItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const fetchingRef = React.useRef(false)

  const fetchWidgetData = useWidgetData()
  const showDateRangeControls = hydrated.dateRangeMode === 'custom' || !context.dateRange
  const refresh = React.useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchTopProductsData(hydrated, context, fetchWidgetData)
      const chartData = result.data.map((item, index) => ({
        name: truncateLabel(item.groupLabel ?? item.groupKey ?? `Product ${index + 1}`, t),
        Revenue: item.value ?? 0,
      }))
      setData(chartData)
    } catch (err) {
      logger.error('Failed to load top products data', { err })
      setError(t('dashboards.analytics.widgets.topProducts.error', 'Failed to load data'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
      fetchingRef.current = false
    }
  }, [context, hydrated, fetchWidgetData, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor="top-products-date-range-mode" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('dashboards.widgets.dateRange.mode.label', 'Date range source')}
          </label>
          <Select
            value={hydrated.dateRangeMode}
            onValueChange={(dateRangeMode) => onSettingsChange({ ...hydrated, dateRangeMode: dateRangeMode as 'global' | 'custom' })}
          >
            <SelectTrigger id="top-products-date-range-mode" size="sm">
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
            id="top-products-date-range"
            label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
            value={hydrated.dateRange}
            onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
          />
        )}
        <div className="space-y-1.5">
          <label
            htmlFor="top-products-limit"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('dashboards.analytics.settings.limit', 'Number of items')}
          </label>
          <Input
            id="top-products-limit"
            type="number"
            min={1}
            max={20}
            className="w-24"
            value={hydrated.limit}
            onChange={(e) => {
              const next = Number(e.target.value)
              onSettingsChange({ ...hydrated, limit: Number.isFinite(next) ? next : hydrated.limit })
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="top-products-layout"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('dashboards.analytics.settings.chartLayout', 'Chart Layout')}
          </label>
          <Select
            value={hydrated.layout}
            onValueChange={(value) => onSettingsChange({ ...hydrated, layout: value as 'horizontal' | 'vertical' })}
          >
            <SelectTrigger id="top-products-layout" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="horizontal">{t('dashboards.analytics.settings.horizontal', 'Horizontal')}</SelectItem>
              <SelectItem value="vertical">{t('dashboards.analytics.settings.vertical', 'Vertical')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {showDateRangeControls && (
        <div className="flex justify-end mb-2">
          <InlineDateRangeSelect
            value={hydrated.dateRange}
            onChange={(dateRange) => onSettingsChange({ ...hydrated, dateRange })}
          />
        </div>
      )}
      <div className="flex-1 min-h-0">
        <BarChart
          data={data}
          index="name"
          categories={['Revenue']}
          categoryLabels={{ Revenue: t('dashboards.analytics.widgets.topCustomers.column.revenue', 'Revenue') }}
          loading={loading}
          error={error}
          layout={hydrated.layout}
          valueFormatter={formatCurrencyCompact}
          colors={['emerald']}
          showLegend={false}
          emptyMessage={t('dashboards.analytics.widgets.topProducts.empty', 'No product sales data for this period')}
        />
      </div>
    </div>
  )
}

export default TopProductsWidget
