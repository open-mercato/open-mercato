"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useWidgetData, type WidgetDataFetcher } from '@open-mercato/ui/backend/dashboard/widgetData'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { BarChart, type BarChartDataItem } from '@open-mercato/ui/backend/charts'
import {
  DateRangeSelect,
  InlineDateRangeSelect,
  type DateRangePreset,
} from '@open-mercato/ui/backend/date-range'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  DEFAULT_SETTINGS,
  buildPipelineDataRequest,
  hydrateSettings,
  type PipelineStatusScope,
  type PipelineSummarySettings,
} from './config'
import type { WidgetDataResponse } from '../../../services/widgetDataService'
import { createCurrencyFormatters } from '../../../lib/formatters'
import { UnlabelledAmountNotice } from '../../../components/UnlabelledAmountNotice'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('dashboards').child({ component: 'pipeline-summary' })

async function fetchPipelineData(settings: PipelineSummarySettings, fetchWidgetData: WidgetDataFetcher): Promise<WidgetDataResponse> {
  return fetchWidgetData<WidgetDataResponse>(buildPipelineDataRequest(settings))
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
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const locale = useLocale()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [data, setData] = React.useState<BarChartDataItem[]>([])
  const [currency, setCurrency] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const money = React.useMemo(() => createCurrencyFormatters(currency, '--', locale), [currency, locale])

  const fetchWidgetData = useWidgetData()
  const refresh = React.useCallback(async () => {
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      const result = await fetchPipelineData(hydrated, fetchWidgetData)
      const chartData = result.data
        .filter((item) => item.groupKey != null && item.groupKey !== '' && String(item.groupKey) !== '0')
        .map((item) => ({
          stage: formatStageLabel(item.groupLabel ?? item.groupKey, t),
          Value: item.value ?? 0,
        }))
      setData(chartData)
      setCurrency(result.metadata?.currency ?? null)
    } catch (err) {
      logger.error('Failed to load pipeline data', { err })
      setError(t('dashboards.analytics.widgets.pipelineSummary.error', 'Failed to load data'))
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
          id="pipeline-summary-date-range"
          label={t('dashboards.analytics.settings.dateRange', 'Date Range')}
          value={hydrated.dateRange}
          onChange={(dateRange: DateRangePreset) => onSettingsChange({ ...hydrated, dateRange })}
        />
        <div className="space-y-1.5">
          <label
            htmlFor="pipeline-summary-status-scope"
            className="text-xs font-semibold uppercase text-muted-foreground"
          >
            {t('dashboards.analytics.settings.dealStatusScope', 'Deals included')}
          </label>
          <Select
            value={hydrated.statusScope}
            onValueChange={(value) => onSettingsChange({ ...hydrated, statusScope: value as PipelineStatusScope })}
          >
            <SelectTrigger id="pipeline-summary-status-scope" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">
                {t('dashboards.analytics.settings.dealStatusScopeOpen', 'Open deals only')}
              </SelectItem>
              <SelectItem value="all">
                {t('dashboards.analytics.settings.dealStatusScopeAll', 'All deals, including won and lost')}
              </SelectItem>
            </SelectContent>
          </Select>
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
        <BarChart
          data={data}
          index="stage"
          categories={['Value']}
          categoryLabels={{ Value: t('dashboards.analytics.labels.value', 'Value') }}
          loading={loading}
          error={error}
          valueFormatter={money.formatCompact}
          colors={['violet']}
          showLegend={false}
          emptyMessage={t('dashboards.analytics.widgets.pipelineSummary.empty', 'No deal data for this period')}
        />
      </div>
      <UnlabelledAmountNotice currency={currency} loading={loading} error={error} />
    </div>
  )
}

export default PipelineSummaryWidget
