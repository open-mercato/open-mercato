"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { KpiCard, type KpiTrend } from '../../../components/charts/KpiCard'
import { DateRangeSelect } from '../../../components/settings/DateRangeSelect'
import { InlineDateRangeSelect } from '../../../components/settings/InlineDateRangeSelect'
import { DEFAULT_SETTINGS, hydrateSettings, type NewCustomersKpiSettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import { type DateRangePreset, getComparisonLabelKey } from '../../../lib/dateRanges'

async function fetchNewCustomersData(settings: NewCustomersKpiSettings): Promise<WidgetDataResponse> {
  const body = {
    entityType: 'customers:entities',
    metric: {
      field: 'id',
      aggregate: 'count',
    },
    dateRange: {
      field: 'createdAt',
      preset: settings.dateRange,
    },
    comparison: settings.showComparison ? { type: 'previous_period' } : undefined,
  }

  const call = await apiCall<WidgetDataResponse>('/api/dashboards/widgets/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!call.ok) {
    const errorMsg = (call.result as Record<string, unknown>)?.error
    throw new Error(typeof errorMsg === 'string' ? errorMsg : 'Failed to fetch new customers data')
  }

  return call.result as WidgetDataResponse
}

const NewCustomersKpiWidget: React.FC<DashboardWidgetComponentProps<NewCustomersKpiSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [value, setValue] = React.useState<number | null>(null)
  const [trend, setTrend] = React.useState<KpiTrend | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const data = await fetchNewCustomersData(hydrated)
      setValue(data.value)
      if (data.comparison) {
        setTrend({
          value: data.comparison.change,
          direction: data.comparison.direction,
        })
      } else {
        setTrend(undefined)
      }
    } catch (err) {
      console.error('Failed to load new customers KPI data', err)
      setError(t('dashboards.analytics.widgets.newCustomersKpi.error', 'Failed to load data'))
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
          id="new-customers-kpi-date-range"
          label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hydrated.showComparison}
              onChange={(e) => onSettingsChange({ ...hydrated, showComparison: e.target.checked })}
              className="h-4 w-4 rounded border focus:ring-primary"
            />
            {t('dashboards.analytics.settings.showComparison', 'Show comparison')}
          </label>
        </div>
      </div>
    )
  }

  const comparisonLabelInfo = getComparisonLabelKey(hydrated.dateRange)
  const comparisonLabel = hydrated.showComparison
    ? t(comparisonLabelInfo.key, comparisonLabelInfo.fallback)
    : undefined

  return (
    <KpiCard
      value={value}
      trend={trend}
      comparisonLabel={comparisonLabel}
      loading={loading}
      error={error}
      headerAction={
        <InlineDateRangeSelect
          value={hydrated.dateRange}
          onChange={(dateRange) => onSettingsChange({ ...hydrated, dateRange })}
        />
      }
    />
  )
}

export default NewCustomersKpiWidget
