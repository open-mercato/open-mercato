"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PieChart, type PieChartDataItem } from '@open-mercato/ui/backend/charts'
import {
  DateRangeSelect,
  InlineDateRangeSelect,
  type DateRangePreset,
} from '@open-mercato/ui/backend/date-range'
import { DEFAULT_SETTINGS, hydrateSettings, type OrdersByStatusSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'

async function fetchOrdersByStatusData(settings: OrdersByStatusSettings): Promise<WidgetDataResponse> {
  const body = {
    entityType: 'sales:orders',
    metric: {
      field: 'id',
      aggregate: 'count',
    },
    groupBy: {
      field: 'status',
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
    throw new Error(typeof errorMsg === 'string' ? errorMsg : 'Failed to fetch orders by status data')
  }

  return call.result as WidgetDataResponse
}

const ORDER_STATUS_KEYS: Record<string, string> = {
  draft: 'dashboards.analytics.orderStatus.draft',
  pending: 'dashboards.analytics.orderStatus.pending',
  confirmed: 'dashboards.analytics.orderStatus.confirmed',
  processing: 'dashboards.analytics.orderStatus.processing',
  shipped: 'dashboards.analytics.orderStatus.shipped',
  delivered: 'dashboards.analytics.orderStatus.delivered',
  cancelled: 'dashboards.analytics.orderStatus.cancelled',
}

function formatStatusLabel(status: string | null, t: (key: string, fallback: string) => string): string {
  if (!status) return t('dashboards.analytics.labels.unknown', 'Unknown')
  const key = ORDER_STATUS_KEYS[status.toLowerCase()]
  if (key) {
    return t(key, status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()))
  }
  return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

const OrdersByStatusWidget: React.FC<DashboardWidgetComponentProps<OrdersByStatusSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [data, setData] = React.useState<PieChartDataItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchOrdersByStatusData(hydrated)
      const chartData = result.data.map((item) => ({
        name: formatStatusLabel(item.groupKey as string | null, t),
        value: item.value ?? 0,
      }))
      setData(chartData)
    } catch (err) {
      console.error('Failed to load orders by status data', err)
      setError(t('dashboards.analytics.widgets.ordersByStatus.error', 'Failed to load data'))
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
          id="orders-by-status-date-range"
          label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
        <div className="space-y-1.5">
          <label
            htmlFor="orders-by-status-variant"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('dashboards.analytics.settings.chartVariant', 'Chart Style')}
          </label>
          <select
            id="orders-by-status-variant"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={hydrated.variant}
            onChange={(e) => onSettingsChange({ ...hydrated, variant: e.target.value as 'pie' | 'donut' })}
          >
            <option value="donut">{t('dashboards.analytics.chartVariant.donut', 'Donut')}</option>
            <option value="pie">{t('dashboards.analytics.chartVariant.pie', 'Pie')}</option>
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
        <PieChart
          data={data}
          loading={loading}
          error={error}
          variant={hydrated.variant}
          colors={['blue', 'emerald', 'amber', 'rose', 'violet', 'cyan']}
          emptyMessage={t('dashboards.analytics.widgets.ordersByStatus.empty', 'No orders for this period')}
        />
      </div>
    </div>
  )
}

export default OrdersByStatusWidget
