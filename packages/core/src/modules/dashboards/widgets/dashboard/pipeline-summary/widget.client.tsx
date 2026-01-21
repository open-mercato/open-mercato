"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart, type BarChartDataItem } from '../../../components/charts/BarChart'
import { DateRangeSelect } from '../../../components/settings/DateRangeSelect'
import { DEFAULT_SETTINGS, hydrateSettings, type PipelineSummarySettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import type { DateRangePreset } from '../../../lib/dateRanges'
import { formatCurrencyCompact } from '../../../lib/formatters'

async function fetchPipelineData(settings: PipelineSummarySettings): Promise<WidgetDataResponse> {
  const body = {
    entityType: 'customers:deals',
    metric: {
      field: 'valueAmount',
      aggregate: 'sum',
    },
    groupBy: {
      field: 'pipelineStage',
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
    throw new Error(typeof errorMsg === 'string' ? errorMsg : 'Failed to fetch pipeline data')
  }

  return call.result as WidgetDataResponse
}

function formatStageLabel(stage: string | null): string {
  if (!stage) return 'Unknown'
  return stage
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
}

const PipelineSummaryWidget: React.FC<DashboardWidgetComponentProps<PipelineSummarySettings>> = ({
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
      const result = await fetchPipelineData(hydrated)
      const chartData = result.data.map((item) => ({
        stage: formatStageLabel(item.groupKey as string | null),
        Value: item.value ?? 0,
      }))
      setData(chartData)
    } catch (err) {
      console.error('Failed to load pipeline data', err)
      setError(t('dashboards.analytics.widgets.pipelineSummary.error', 'Failed to load data'))
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
          id="pipeline-summary-date-range"
          label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
      </div>
    )
  }

  return (
    <BarChart
      title={t('dashboards.analytics.widgets.pipelineSummary.title', 'Pipeline Summary')}
      data={data}
      index="stage"
      categories={['Value']}
      loading={loading}
      error={error}
      valueFormatter={formatCurrencyCompact}
      colors={['violet']}
      showLegend={false}
      emptyMessage={t('dashboards.analytics.widgets.pipelineSummary.empty', 'No deal data for this period')}
    />
  )
}

export default PipelineSummaryWidget
