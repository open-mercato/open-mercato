"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useWidgetData, type WidgetDataFetcher } from '@open-mercato/ui/backend/dashboard/widgetData'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart, type BarChartDataItem } from '@open-mercato/ui/backend/charts'
import {
  DateRangeSelect,
  InlineDateRangeSelect,
  type DateRangePreset,
} from '@open-mercato/ui/backend/date-range'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { DEFAULT_SETTINGS, hydrateSettings, type PipelineSummarySettings } from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import { formatCurrencyCompact } from '../../../lib/formatters'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'pipeline-summary' })

async function fetchPipelineData(
  settings: PipelineSummarySettings,
  context: DashboardWidgetComponentProps<PipelineSummarySettings>['context'],
  fetchWidgetData: WidgetDataFetcher,
): Promise<WidgetDataResponse> {
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
    dateRange: settings.dateRangeMode === 'global' && context.dateRange
      ? { field: 'createdAt', from: context.dateRange.from, to: context.dateRange.to }
      : { field: 'createdAt', preset: settings.dateRange },
  }

  return fetchWidgetData<WidgetDataResponse>(body)
}

function formatStageLabel(stage: unknown, t: (key: string, fallback: string) => string): string {
  if (stage == null || stage === '') return t('dashboards.analytics.labels.unknown', 'Unknown')
  const stageStr = String(stage)
  if (stageStr === '0' || stageStr === 'null' || stageStr === 'undefined') {
    return t('dashboards.analytics.labels.unknown', 'Unknown')
  }
  return stageStr
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
}

const PipelineSummaryWidget: React.FC<DashboardWidgetComponentProps<PipelineSummarySettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  context,
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
  const showDateRangeControls = hydrated.dateRangeMode === 'custom' || !context.dateRange
  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchPipelineData(hydrated, context, fetchWidgetData)
      const chartData = result.data
        .filter((item) => item.groupKey != null && item.groupKey !== '' && String(item.groupKey) !== '0')
        .map((item) => ({
          stage: formatStageLabel(item.groupLabel ?? item.groupKey, t),
          Value: item.value ?? 0,
        }))
      setData(chartData)
    } catch (err) {
      logger.error('Failed to load pipeline data', { err })
      setError(t('dashboards.analytics.widgets.pipelineSummary.error', 'Failed to load data'))
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
          <label htmlFor="pipeline-summary-date-range-mode" className="text-xs font-semibold uppercase text-muted-foreground">
            {t('dashboards.widgets.dateRange.mode.label', 'Date range source')}
          </label>
          <Select
            value={hydrated.dateRangeMode}
            onValueChange={(dateRangeMode) => onSettingsChange({ ...hydrated, dateRangeMode: dateRangeMode as 'global' | 'custom' })}
          >
            <SelectTrigger id="pipeline-summary-date-range-mode" size="sm">
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
            id="pipeline-summary-date-range"
            label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
            value={hydrated.dateRange}
            onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {showDateRangeControls && (
        <div className="flex justify-end mb-2">
          <InlineDateRangeSelect
            value={hydrated.dateRange}
            onChange={(dateRange) => onSettingsChange({ ...hydrated, dateRange })}
          />
        </div>
      )}
      <div className="flex-1 min-h-0">
        <BarChart
          data={data}
          index="stage"
          categories={['Value']}
          categoryLabels={{ Value: t('dashboards.analytics.labels.value', 'Value') }}
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
