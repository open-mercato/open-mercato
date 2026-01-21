"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart, type BarChartDataItem } from '../../../components/charts/BarChart'
import { DateRangeSelect } from '../../../components/settings/DateRangeSelect'
import { DEFAULT_SETTINGS, hydrateSettings, type SalesByRegionSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import type { DateRangePreset } from '../../../lib/dateRanges'
import { formatCurrencyCompact } from '../../../lib/formatters'

async function fetchSalesByRegionData(settings: SalesByRegionSettings): Promise<WidgetDataResponse> {
  const body = {
    entityType: 'sales:orders',
    metric: {
      field: 'grandTotalGrossAmount',
      aggregate: 'sum',
    },
    groupBy: {
      field: 'shippingAddressSnapshot.region',
      limit: settings.limit,
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
    throw new Error(typeof errorMsg === 'string' ? errorMsg : 'Failed to fetch sales by region data')
  }

  return call.result as WidgetDataResponse
}

const SalesByRegionWidget: React.FC<DashboardWidgetComponentProps<SalesByRegionSettings>> = ({
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

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSalesByRegionData(hydrated)
      const chartData = result.data.map((item) => ({
        region: String(item.groupKey || 'Unknown'),
        Revenue: item.value ?? 0,
      }))
      setData(chartData)
    } catch (err) {
      console.error('Failed to load sales by region data', err)
      setError(t('dashboards.analytics.widgets.salesByRegion.error', 'Failed to load data'))
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
          id="sales-by-region-date-range"
          label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
        <div className="space-y-1.5">
          <label
            htmlFor="sales-by-region-limit"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('dashboards.analytics.settings.limit', 'Number of items')}
          </label>
          <input
            id="sales-by-region-limit"
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
      </div>
    )
  }

  return (
    <BarChart
      title={t('dashboards.analytics.widgets.salesByRegion.title', 'Sales by Region')}
      data={data}
      index="region"
      categories={['Revenue']}
      loading={loading}
      error={error}
      layout="horizontal"
      valueFormatter={formatCurrencyCompact}
      colors={['cyan']}
      showLegend={false}
      emptyMessage={t('dashboards.analytics.widgets.salesByRegion.empty', 'No regional sales data for this period')}
    />
  )
}

export default SalesByRegionWidget
