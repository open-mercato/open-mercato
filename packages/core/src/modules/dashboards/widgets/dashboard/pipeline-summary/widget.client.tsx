"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart, type BarChartDataItem } from '../../../components/charts/BarChart'
import { DateRangeSelect } from '../../../components/settings/DateRangeSelect'
import { InlineDateRangeSelect } from '../../../components/settings/InlineDateRangeSelect'
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
    throw new Error(typeof errorMsg === 'string' ? errorMsg : 'Failed to fetch pipeline data')
  }

  return call.result as WidgetDataResponse
}

function formatStageLabel(stage: unknown): string {
  if (stage == null || stage === '') return 'Unknown'
  const stageStr = String(stage)
  if (stageStr === '0' || stageStr === 'null' || stageStr === 'undefined') return 'Unknown'
  return stageStr
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
      const chartData = result.data
        .filter((item) => item.groupKey != null && item.groupKey !== '' && String(item.groupKey) !== '0')
        .map((item) => ({
          stage: formatStageLabel(item.groupLabel ?? item.groupKey),
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
          index="stage"
          categories={['Value']}
          loading={loading}
          error={error}
          valueFormatter={formatCurrencyCompact}
          colors={['violet']}
          showLegend={false}
          emptyMessage={t('dashboards.analytics.widgets.pipelineSummary.empty', 'No deal data for this period')}
        />
      </div>
    </div>
  )
}

export default PipelineSummaryWidget
