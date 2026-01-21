"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TopNTable, type TopNTableColumn } from '../../../components/charts/TopNTable'
import { DateRangeSelect } from '../../../components/settings/DateRangeSelect'
import { DEFAULT_SETTINGS, hydrateSettings, type TopCustomersSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import type { DateRangePreset } from '../../../lib/dateRanges'
import { formatCurrencySafe } from '../../../lib/formatters'

type CustomerRow = {
  rank: number
  customerId: string
  revenue: number
}

async function fetchTopCustomersData(settings: TopCustomersSettings): Promise<WidgetDataResponse> {
  const body = {
    entityType: 'sales:orders',
    metric: {
      field: 'grandTotalGrossAmount',
      aggregate: 'sum',
    },
    groupBy: {
      field: 'customerEntityId',
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
    throw new Error(typeof errorMsg === 'string' ? errorMsg : 'Failed to fetch top customers data')
  }

  return call.result as WidgetDataResponse
}

function truncateId(id: string | null): string {
  if (!id) return 'Unknown'
  if (id.length <= 12) return id
  return id.slice(0, 8) + '...'
}

const TopCustomersWidget: React.FC<DashboardWidgetComponentProps<TopCustomersSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [data, setData] = React.useState<CustomerRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const columns: TopNTableColumn<CustomerRow>[] = React.useMemo(
    () => [
      {
        key: 'rank',
        header: '#',
        width: '40px',
      },
      {
        key: 'customerId',
        header: t('dashboards.analytics.widgets.topCustomers.column.customer', 'Customer'),
        formatter: (value) => truncateId(String(value || '')),
      },
      {
        key: 'revenue',
        header: t('dashboards.analytics.widgets.topCustomers.column.revenue', 'Revenue'),
        align: 'right',
        formatter: (value: unknown) => formatCurrencySafe(value),
      },
    ],
    [t],
  )

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchTopCustomersData(hydrated)
      const tableData: CustomerRow[] = result.data.map((item, index) => ({
        rank: index + 1,
        customerId: String(item.groupKey || 'Unknown'),
        revenue: item.value ?? 0,
      }))
      setData(tableData)
    } catch (err) {
      console.error('Failed to load top customers data', err)
      setError(t('dashboards.analytics.widgets.topCustomers.error', 'Failed to load data'))
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
          id="top-customers-date-range"
          label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
        <div className="space-y-1.5">
          <label
            htmlFor="top-customers-limit"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('dashboards.analytics.settings.limit', 'Number of items')}
          </label>
          <input
            id="top-customers-limit"
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
    <TopNTable
      title={t('dashboards.analytics.widgets.topCustomers.title', 'Top Customers by Revenue')}
      data={data}
      columns={columns}
      loading={loading}
      error={error}
      emptyMessage={t('dashboards.analytics.widgets.topCustomers.empty', 'No customer data for this period')}
    />
  )
}

export default TopCustomersWidget
