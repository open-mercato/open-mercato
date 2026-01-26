"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart, type BarChartDataItem } from '@open-mercato/ui/backend/charts'
import { DateRangeSelect, InlineDateRangeSelect, type DateRangePreset } from '@open-mercato/ui/backend/date-range'
import { DEFAULT_SETTINGS, hydrateSettings, type TopProductsSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import { formatCurrencyCompact } from '../../../lib/formatters'

async function fetchTopProductsData(settings: TopProductsSettings): Promise<WidgetDataResponse> {
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
    dateRange: {
      field: 'createdAt',
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
    throw new Error(typeof errorMsg === 'string' ? errorMsg : 'Failed to fetch top products data')
  }

  return call.result as WidgetDataResponse
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

  const refresh = React.useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchTopProductsData(hydrated)
      const chartData = result.data.map((item, index) => ({
        name: truncateLabel(item.groupLabel ?? item.groupKey ?? `Product ${index + 1}`, t),
        Revenue: item.value ?? 0,
      }))
      setData(chartData)
    } catch (err) {
      console.error('Failed to load top products data', err)
      setError(t('dashboards.analytics.widgets.topProducts.error', 'Failed to load data'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
      fetchingRef.current = false
    }
  }, [hydrated, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <DateRangeSelect
          id="top-products-date-range"
          label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
        <div className="space-y-1.5">
          <label
            htmlFor="top-products-limit"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('dashboards.analytics.settings.limit', 'Number of items')}
          </label>
          <input
            id="top-products-limit"
            type="number"
            min={1}
            max={20}
            className="w-24 rounded-md border px-2 py-1 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
          <select
            id="top-products-layout"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.layout}
            onChange={(e) => onSettingsChange({ ...hydrated, layout: e.target.value as 'horizontal' | 'vertical' })}
          >
            <option value="horizontal">{t('dashboards.analytics.settings.horizontal', 'Horizontal')}</option>
            <option value="vertical">{t('dashboards.analytics.settings.vertical', 'Vertical')}</option>
          </select>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-end mb-2">
        <InlineDateRangeSelect
          value={hydrated.dateRange}
          onChange={(dateRange) => onSettingsChange({ ...hydrated, dateRange })}
        />
      </div>
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
