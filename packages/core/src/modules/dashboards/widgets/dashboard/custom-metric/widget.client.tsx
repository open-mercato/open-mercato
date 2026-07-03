"use client"

import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { useWidgetData } from '@open-mercato/ui/backend/dashboard/widgetData'
import { BarChart, KpiCard, LineChart, PieChart, TopNTable, type TopNTableColumn } from '@open-mercato/ui/backend/charts'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { DEFAULT_SETTINGS, hydrateSettings, type CustomMetricSettings } from './config'
import { buildRequest, findField, normalizeSettings, useCustomMetricCatalog } from './lib'
import type { DateGranularity } from '../../../lib/aggregations'
import type { WidgetDataResponse } from '../../../services/widgetDataService'

type ChartRow = Record<string, string | number | null | undefined>
type TableRow = Record<string, unknown> & { rank: number; label: string; value: number }

const VALUE_KEY = 'value'

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatGroupLabel(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function formatDateGroup(value: unknown, granularity: DateGranularity | null, locale?: string): string {
  const raw = formatGroupLabel(value, '')
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  switch (granularity) {
    case 'month':
      return date.toLocaleDateString(locale, { month: 'short', year: 'numeric' })
    case 'quarter':
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
    case 'year':
      return date.toLocaleDateString(locale, { year: 'numeric' })
    default:
      return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }
}

const CustomMetricWidgetClient: React.FC<DashboardWidgetComponentProps<CustomMetricSettings>> = ({
  mode,
  settings = DEFAULT_SETTINGS,
  context,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const locale = useLocale()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const { catalog, loading: catalogLoading, error: catalogError } = useCustomMetricCatalog()
  const [data, setData] = React.useState<WidgetDataResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const fetchWidgetData = useWidgetData()
  const normalized = React.useMemo(() => normalizeSettings(hydrated, catalog), [catalog, hydrated])
  const entity = React.useMemo(
    () => catalog.find((item) => item.entityType === normalized.entityType) ?? null,
    [catalog, normalized.entityType],
  )
  const selectedMetric = findField(entity, normalized.metricField)
  const selectedGroup = findField(entity, normalized.groupByField)
  const request = React.useMemo(() => buildRequest(normalized, entity, context), [context, entity, normalized])
  const displayTitle = normalized.title.trim() || t('dashboards.widgets.customMetric.title')
  const loadError = t('dashboards.widgets.customMetric.errors.loadCatalog')

  const refresh = React.useCallback(async () => {
    if (!request || mode !== 'view') return
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      setData(await fetchWidgetData<WidgetDataResponse>(request))
    } catch {
      setError(loadError)
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [fetchWidgetData, loadError, mode, onRefreshStateChange, request])

  React.useEffect(() => {
    if (mode === 'view') refresh().catch(() => {})
  }, [mode, refresh, refreshToken])

  if (catalogLoading) return <KpiCard value={null} loading />
  if (catalogError) return <KpiCard value={null} error={loadError} />
  if (!request) {
    return <EmptyState size="sm" title={t('dashboards.widgets.customMetric.title')} description={t('dashboards.widgets.customMetric.description')} />
  }

  const unknownLabel = t('dashboards.analytics.labels.unknown')
  const groupLabel = selectedGroup?.label ?? t('dashboards.widgets.customMetric.settings.groupBy')
  const valueLabel = selectedMetric?.label ?? t('dashboards.analytics.labels.value')
  const groupedRows = data?.data ?? []
  const chartRows: ChartRow[] = groupedRows.map((item) => ({
    group: normalized.visualization === 'line' ? formatDateGroup(item.groupKey, normalized.granularity, locale) : formatGroupLabel(item.groupLabel ?? item.groupKey, unknownLabel),
    [VALUE_KEY]: item.value ?? 0,
  }))
  const tableRows: TableRow[] = groupedRows.map((item, index) => ({
    rank: index + 1,
    label: formatGroupLabel(item.groupLabel ?? item.groupKey, unknownLabel),
    value: item.value ?? 0,
  }))
  const tableColumns: TopNTableColumn<TableRow>[] = [
    { key: 'rank', header: '#', width: '40px' },
    { key: 'label', header: groupLabel },
    { key: 'value', header: valueLabel, align: 'right', formatter: (value) => typeof value === 'number' ? formatNumber(value) : String(value ?? '') },
  ]
  const comparisonLabel = context.dateRange?.compare === 'previous_year'
    ? t('dashboards.analytics.comparison.vsLastYear')
    : t('dashboards.analytics.comparison.vsPreviousPeriod')
  const delta = data?.comparison ? { value: data.comparison.change, direction: data.comparison.direction } : undefined

  if (normalized.visualization === 'kpi') {
    return <KpiCard title={displayTitle} value={data?.value ?? null} loading={loading} error={error} delta={delta} comparisonLabel={delta ? comparisonLabel : undefined} formatValue={formatNumber} />
  }
  if (normalized.visualization === 'line') {
    return <LineChart title={displayTitle} data={chartRows} index="group" categories={[VALUE_KEY]} categoryLabels={{ [VALUE_KEY]: valueLabel }} loading={loading} error={error} colors={['blue']} valueFormatter={formatNumber} emptyMessage={t('dashboards.widgets.customMetric.description')} />
  }
  if (normalized.visualization === 'bar') {
    return <BarChart title={displayTitle} data={chartRows} index="group" categories={[VALUE_KEY]} categoryLabels={{ [VALUE_KEY]: valueLabel }} loading={loading} error={error} colors={['blue']} valueFormatter={formatNumber} emptyMessage={t('dashboards.widgets.customMetric.description')} />
  }
  if (normalized.visualization === 'donut') {
    return <PieChart title={displayTitle} data={tableRows.map((row) => ({ name: row.label, value: row.value }))} loading={loading} error={error} variant="donut" colors={['blue', 'emerald', 'amber', 'violet', 'cyan']} valueFormatter={formatNumber} emptyMessage={t('dashboards.widgets.customMetric.description')} />
  }
  return <TopNTable title={displayTitle} data={tableRows} columns={tableColumns} loading={loading} error={error} emptyMessage={t('dashboards.widgets.customMetric.description')} />
}

export default CustomMetricWidgetClient
