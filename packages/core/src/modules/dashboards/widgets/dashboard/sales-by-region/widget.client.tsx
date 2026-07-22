"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useWidgetData, type WidgetDataFetcher } from '@open-mercato/ui/backend/dashboard/widgetData'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart, type BarChartDataItem } from '@open-mercato/ui/backend/charts'
import { DateRangeSelect, type DateRangePreset } from '@open-mercato/ui/backend/date-range'
import { Input } from '@open-mercato/ui/primitives/input'
import { DEFAULT_SETTINGS, hydrateSettings, type SalesByRegionSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import { formatCurrencyCompact } from '../../../lib/formatters'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'sales-by-region' })

async function fetchSalesByRegionData(settings: SalesByRegionSettings, fetchWidgetData: WidgetDataFetcher): Promise<WidgetDataResponse> {
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

  return fetchWidgetData<WidgetDataResponse>(body)
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

  const fetchWidgetData = useWidgetData()
  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchSalesByRegionData(hydrated, fetchWidgetData)
      const chartData = result.data.map((item) => ({
        region: String(item.groupKey || t('dashboards.analytics.labels.unknown', 'Unknown')),
        Revenue: item.value ?? 0,
      }))
      setData(chartData)
    } catch (err) {
      logger.error('Failed to load sales by region data', { err })
      setError(t('dashboards.analytics.widgets.salesByRegion.error', 'Failed to load data'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [hydrated, fetchWidgetData, onRefreshStateChange, t])

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
          <Input
            id="sales-by-region-limit"
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
      </div>
    )
  }

  return (
    <BarChart
      data={data}
      index="region"
      categories={['Revenue']}
      categoryLabels={{ Revenue: t('dashboards.analytics.widgets.topCustomers.column.revenue', 'Revenue') }}
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
