"use client"

import * as React from 'react'
import type { DashboardDateRangeCompare, DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useWidgetData, type WidgetDataFetcher } from '@open-mercato/ui/backend/dashboard/widgetData'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { KpiCard, type KpiTrend } from '@open-mercato/ui/backend/charts'
import {
  DateRangeSelect,
  InlineDateRangeSelect,
  type DateRangePreset,
  getComparisonLabelKey,
} from '@open-mercato/ui/backend/date-range'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { DEFAULT_SETTINGS, hydrateSettings, type OrdersKpiSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import { buildKpiWidgetRequests, mapKpiSeriesToTrend } from '../../../lib/kpiRequests'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'orders-kpi' })

function getWidgetCompare(settings: OrdersKpiSettings): DashboardDateRangeCompare {
  return settings.showComparison ? 'previous_period' : 'none'
}

function getComparisonLabel(
  compare: DashboardDateRangeCompare,
  settings: OrdersKpiSettings,
  usesDashboardDateRange: boolean,
  t: (key: string, fallback: string) => string,
): string | undefined {
  if (compare === 'none') return undefined
  if (usesDashboardDateRange) {
    if (compare === 'previous_year') return t('dashboards.analytics.comparison.vsLastYear', 'vs last year')
    return t('dashboards.analytics.comparison.vsPreviousPeriod', 'vs previous period')
  }
  const comparisonLabelInfo = getComparisonLabelKey(settings.dateRange)
  return t(comparisonLabelInfo.key, comparisonLabelInfo.fallback)
}

async function fetchOrdersData(
  settings: OrdersKpiSettings,
  context: DashboardWidgetComponentProps<OrdersKpiSettings>['context'],
  fetchWidgetData: WidgetDataFetcher,
): Promise<{ data: WidgetDataResponse; trend?: number[]; compare: DashboardDateRangeCompare; usesDashboardDateRange: boolean }> {
  const requests = buildKpiWidgetRequests('orders', {
    dateRangeMode: settings.dateRangeMode,
    dateRange: settings.dateRange,
    compare: getWidgetCompare(settings),
    dashboardDateRange: context.dateRange,
  })
  const seriesPromise = fetchWidgetData<WidgetDataResponse>(requests.seriesRequest)
    .then(mapKpiSeriesToTrend)
    .catch((err) => {
      logger.error('Failed to load orders KPI sparkline data', { err })
      return undefined
    })
  const [data, trend] = await Promise.all([
    fetchWidgetData<WidgetDataResponse>(requests.valueRequest),
    seriesPromise,
  ])
  return { data, trend, compare: requests.compare, usesDashboardDateRange: requests.usesDashboardDateRange }
}

const OrdersKpiWidget: React.FC<DashboardWidgetComponentProps<OrdersKpiSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  context,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [value, setValue] = React.useState<number | null>(null)
  const [delta, setDelta] = React.useState<KpiTrend | undefined>(undefined)
  const [sparkline, setSparkline] = React.useState<number[] | undefined>(undefined)
  const [comparisonLabel, setComparisonLabel] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const fetchWidgetData = useWidgetData()
  const showDateRangeControls = hydrated.dateRangeMode === 'custom' || !context.dateRange
  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const { data, trend, compare, usesDashboardDateRange } = await fetchOrdersData(hydrated, context, fetchWidgetData)
      setValue(data.value)
      setSparkline(trend)
      setComparisonLabel(getComparisonLabel(compare, hydrated, usesDashboardDateRange, t))
      if (data.comparison) {
        setDelta({
          value: data.comparison.change,
          direction: data.comparison.direction,
        })
      } else {
        setDelta(undefined)
      }
    } catch (err) {
      logger.error('Failed to load orders KPI data', { err })
      setError(t('dashboards.analytics.widgets.ordersKpi.error', 'Failed to load data'))
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [context, hydrated, fetchWidgetData, onRefreshStateChange, t])

  React.useEffect(() => {
    refresh().catch(() => {})
  }, [refresh, refreshToken])

  if (mode === 'settings') {
    return (
      <div className="space-y-4 text-sm">
        <div className="space-y-1.5">
          <label htmlFor="orders-kpi-date-range-mode" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('dashboards.widgets.dateRange.mode.label', 'Date range source')}
          </label>
          <Select
            value={hydrated.dateRangeMode}
            onValueChange={(dateRangeMode) => onSettingsChange({ ...hydrated, dateRangeMode: dateRangeMode as 'global' | 'custom' })}
          >
            <SelectTrigger id="orders-kpi-date-range-mode" size="sm">
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
            id="orders-kpi-date-range"
            label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
            value={hydrated.dateRange}
            onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
          />
        )}
        <CheckboxField
          id="orders-kpi-show-comparison"
          checked={hydrated.showComparison}
          onCheckedChange={(checked) => onSettingsChange({ ...hydrated, showComparison: checked === true })}
          label={t('dashboards.analytics.settings.showComparison', 'Show comparison')}
        />
      </div>
    )
  }

  return (
    <KpiCard
      value={value}
      trend={sparkline}
      delta={delta}
      comparisonLabel={comparisonLabel}
      loading={loading}
      error={error}
      headerAction={showDateRangeControls ? (
        <InlineDateRangeSelect
          value={hydrated.dateRange}
          onChange={(dateRange) => onSettingsChange({ ...hydrated, dateRange })}
        />
      ) : null}
    />
  )
}

export default OrdersKpiWidget
