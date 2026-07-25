"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useWidgetData, type WidgetDataFetcher } from '@open-mercato/ui/backend/dashboard/widgetData'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TopNTable, type TopNTableColumn } from '@open-mercato/ui/backend/charts'
import { DateRangeSelect, type DateRangePreset } from '@open-mercato/ui/backend/date-range'
import { Input } from '@open-mercato/ui/primitives/input'
import { DEFAULT_SETTINGS, hydrateSettings, type TopCustomersSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import { formatCurrencySafe } from '../../../lib/formatters'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'top-customers' })

type CustomerRow = {
  rank: number
  customerId: string
  revenue: number
}

async function fetchTopCustomersData(settings: TopCustomersSettings, fetchWidgetData: WidgetDataFetcher): Promise<WidgetDataResponse> {
  const body = {
    entityType: 'sales:orders',
    metric: {
      field: 'grandTotalGrossAmount',
      aggregate: 'sum',
    },
    groupBy: {
      field: 'customerEntityId',
      limit: settings.limit,
      resolveLabels: true,
    },
    dateRange: {
      field: 'placedAt',
      preset: settings.dateRange,
    },
  }

  return fetchWidgetData<WidgetDataResponse>(body)
}

function formatCustomerName(name: string | null, unknownLabel: string): string {
  if (!name) return unknownLabel
  return name
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

  const unknownLabel = t('dashboards.analytics.labels.unknown', 'Unknown')
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
        formatter: (value) => formatCustomerName(String(value || ''), unknownLabel),
      },
      {
        key: 'revenue',
        header: t('dashboards.analytics.widgets.topCustomers.column.revenue', 'Revenue'),
        align: 'right',
        formatter: (value: unknown) => formatCurrencySafe(value),
      },
    ],
    [t, unknownLabel],
  )

  const fetchWidgetData = useWidgetData()
  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchTopCustomersData(hydrated, fetchWidgetData)
      const tableData: CustomerRow[] = result.data.map((item, index) => ({
        rank: index + 1,
        customerId: item.groupLabel || String(item.groupKey || t('dashboards.analytics.labels.unknown', 'Unknown')),
        revenue: item.value ?? 0,
      }))
      setData(tableData)
    } catch (err) {
      logger.error('Failed to load top customers data', { err })
      setError(t('dashboards.analytics.widgets.topCustomers.error', 'Failed to load data'))
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
          <Input
            id="top-customers-limit"
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
    <TopNTable
      data={data}
      columns={columns}
      loading={loading}
      error={error}
      emptyMessage={t('dashboards.analytics.widgets.topCustomers.empty', 'No customer data for this period')}
    />
  )
}

export default TopCustomersWidget
