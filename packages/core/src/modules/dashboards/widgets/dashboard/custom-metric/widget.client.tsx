"use client"

import * as React from 'react'
import type { DashboardDateRangeCompare, DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT, useLocale } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useWidgetData, type WidgetDataFetcher } from '@open-mercato/ui/backend/dashboard/widgetData'
import { BarChart, KpiCard, LineChart, PieChart, TopNTable, type TopNTableColumn } from '@open-mercato/ui/backend/charts'
import { DateRangeSelect, type DateRangePreset } from '@open-mercato/ui/backend/date-range'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { DEFAULT_SETTINGS, hydrateSettings, type CustomMetricSettings, type CustomMetricVisualization } from './config'
import type { AggregateFunction, DateGranularity } from '../../../lib/aggregations'
import type { WidgetDataRequest, WidgetDataResponse } from '../../../services/widgetDataService'

type CatalogField = {
  field: string
  label: string
  kind: 'numeric' | 'text' | 'uuid' | 'timestamp' | 'jsonb'
  aggregates: AggregateFunction[]
  groupable: boolean
}

type CatalogEntity = {
  entityType: string
  label: string
  dateField: string | null
  fields: CatalogField[]
}

type CatalogResponse = { entities: CatalogEntity[] }
type ChartRow = Record<string, string | number | null | undefined>
type TableRow = Record<string, unknown> & { rank: number; label: string; value: number }

const DEFAULT_DATE_RANGE_PRESET: DateRangePreset = 'last_30_days'
const GRANULARITY_OPTIONS: DateGranularity[] = ['day', 'week', 'month', 'quarter', 'year']
const VISUALIZATIONS: CustomMetricVisualization[] = ['kpi', 'line', 'bar', 'donut', 'table']
const VALUE_KEY = 'value'

function clampLimit(limit: number): number {
  return Math.min(20, Math.max(1, Math.floor(limit)))
}

function isCategoricalField(field: CatalogField): boolean {
  return field.groupable && (field.kind === 'text' || field.kind === 'uuid')
}

function metricFields(entity: CatalogEntity | null, aggregate: AggregateFunction): CatalogField[] {
  if (!entity) return []
  return aggregate === 'count' ? entity.fields : entity.fields.filter((field) => field.kind === 'numeric')
}

function groupFields(entity: CatalogEntity | null, visualization: CustomMetricVisualization): CatalogField[] {
  if (!entity || visualization === 'kpi') return []
  if (visualization === 'line') return entity.fields.filter((field) => field.groupable && field.kind === 'timestamp')
  return entity.fields.filter(isCategoricalField)
}

function findField(entity: CatalogEntity | null, fieldName: string | null): CatalogField | null {
  return entity?.fields.find((field) => field.field === fieldName) ?? null
}

function firstMetricField(entity: CatalogEntity, aggregate: AggregateFunction): string | null {
  if (aggregate === 'count') {
    return entity.fields.find((field) => field.field === 'id')?.field ?? entity.fields[0]?.field ?? null
  }
  return entity.fields.find((field) => field.kind === 'numeric')?.field ?? null
}

function normalizeSettings(settings: CustomMetricSettings, catalog: CatalogEntity[]): CustomMetricSettings {
  const entity = catalog.find((item) => item.entityType === settings.entityType) ?? null
  const next: CustomMetricSettings = { ...settings, limit: clampLimit(settings.limit) }
  if (!entity) return next

  const fieldsForAggregate = metricFields(entity, next.aggregate)
  if (!next.metricField || !fieldsForAggregate.some((field) => field.field === next.metricField)) {
    next.metricField = firstMetricField(entity, next.aggregate)
  }

  const selectedField = findField(entity, next.metricField)
  if (selectedField && !selectedField.aggregates.includes(next.aggregate)) {
    next.aggregate = selectedField.aggregates[0] ?? 'count'
  }

  const fieldsAfterAggregate = metricFields(entity, next.aggregate)
  if (!next.metricField || !fieldsAfterAggregate.some((field) => field.field === next.metricField)) {
    next.metricField = firstMetricField(entity, next.aggregate)
  }

  if (next.visualization === 'kpi') {
    next.groupByField = null
    next.granularity = null
    return next
  }

  const allowedGroupFields = groupFields(entity, next.visualization)
  const preferredDateField = next.visualization === 'line' ? entity.dateField : null
  if (!next.groupByField || !allowedGroupFields.some((field) => field.field === next.groupByField)) {
    next.groupByField = preferredDateField && allowedGroupFields.some((field) => field.field === preferredDateField)
      ? preferredDateField
      : allowedGroupFields[0]?.field ?? null
  }
  next.granularity = next.visualization === 'line' ? next.granularity ?? 'day' : null
  return next
}

function buildDateRange(
  settings: CustomMetricSettings,
  entity: CatalogEntity,
  context: DashboardWidgetComponentProps<CustomMetricSettings>['context'],
): WidgetDataRequest['dateRange'] | undefined {
  if (!entity.dateField) return undefined
  if (settings.dateRangeMode === 'global' && context.dateRange) {
    return { field: entity.dateField, from: context.dateRange.from, to: context.dateRange.to }
  }
  return { field: entity.dateField, preset: settings.dateRangePreset ?? DEFAULT_DATE_RANGE_PRESET }
}

function buildComparison(
  settings: CustomMetricSettings,
  context: DashboardWidgetComponentProps<CustomMetricSettings>['context'],
): WidgetDataRequest['comparison'] | undefined {
  if (settings.visualization !== 'kpi' || settings.dateRangeMode !== 'global') return undefined
  const compare: DashboardDateRangeCompare | undefined = context.dateRange?.compare
  return compare && compare !== 'none' ? { type: compare } : undefined
}

function buildRequest(
  settings: CustomMetricSettings,
  entity: CatalogEntity | null,
  context: DashboardWidgetComponentProps<CustomMetricSettings>['context'],
): WidgetDataRequest | null {
  if (!entity || !settings.metricField) return null
  const request: WidgetDataRequest = {
    entityType: entity.entityType,
    metric: { field: settings.metricField, aggregate: settings.aggregate },
    dateRange: buildDateRange(settings, entity, context),
    comparison: buildComparison(settings, context),
  }
  if (settings.visualization !== 'kpi') {
    if (!settings.groupByField) return null
    request.groupBy = settings.visualization === 'line'
      ? { field: settings.groupByField, granularity: settings.granularity ?? 'day' }
      : { field: settings.groupByField, limit: settings.limit, resolveLabels: true }
  }
  return request
}

async function fetchCatalog(): Promise<CatalogEntity[]> {
  const call = await apiCall<CatalogResponse>('/api/dashboards/analytics/catalog')
  if (!call.ok || !call.result) throw new Error('[internal] custom-metric catalog load failed')
  return call.result.entities
}

async function fetchCustomMetricData(
  request: WidgetDataRequest,
  fetchWidgetData: WidgetDataFetcher,
): Promise<WidgetDataResponse> {
  return fetchWidgetData<WidgetDataResponse>(request)
}

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
  onSettingsChange,
  refreshToken,
  onRefreshStateChange,
}) => {
  const t = useT()
  const locale = useLocale()
  const hydrated = React.useMemo(() => hydrateSettings(settings), [settings])
  const [catalog, setCatalog] = React.useState<CatalogEntity[]>([])
  const [catalogLoading, setCatalogLoading] = React.useState(true)
  const [catalogError, setCatalogError] = React.useState<string | null>(null)
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
  const loadCatalogError = t('dashboards.widgets.customMetric.errors.loadCatalog')

  const reloadCatalog = React.useCallback(async () => {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      setCatalog(await fetchCatalog())
    } catch {
      setCatalogError(loadCatalogError)
    } finally {
      setCatalogLoading(false)
    }
  }, [loadCatalogError])

  React.useEffect(() => {
    reloadCatalog().catch(() => {})
  }, [reloadCatalog])

  const updateSettings = React.useCallback((next: CustomMetricSettings) => {
    onSettingsChange(normalizeSettings(next, catalog))
  }, [catalog, onSettingsChange])

  const refresh = React.useCallback(async () => {
    if (!request || mode !== 'view') return
    onRefreshStateChange?.(true)
    setLoading(true)
    setError(null)
    try {
      setData(await fetchCustomMetricData(request, fetchWidgetData))
    } catch {
      setError(loadCatalogError)
    } finally {
      setLoading(false)
      onRefreshStateChange?.(false)
    }
  }, [fetchWidgetData, loadCatalogError, mode, onRefreshStateChange, request])

  React.useEffect(() => {
    if (mode === 'view') refresh().catch(() => {})
  }, [mode, refresh, refreshToken])

  if (mode === 'settings') {
    const metricOptions = metricFields(entity, normalized.aggregate)
    const aggregateOptions = selectedMetric?.aggregates ?? ['count']
    const currentGroupFields = groupFields(entity, normalized.visualization)
    const showPreset = normalized.dateRangeMode === 'custom' || !context.dateRange
    const hasTimestampGroup = groupFields(entity, 'line').length > 0
    const hasCategoricalGroup = groupFields(entity, 'bar').length > 0

    return (
      <div className="space-y-4 text-sm">
        {catalogLoading ? <div className="flex justify-center py-3"><Spinner className="size-5 text-muted-foreground" /></div> : null}
        {catalogError ? <p className="text-sm text-destructive">{catalogError}</p> : null}
        <div className="space-y-1.5">
          <Label htmlFor="custom-metric-entity" className="text-xs font-semibold uppercase text-muted-foreground">{t('dashboards.widgets.customMetric.settings.entity')}</Label>
          <Select value={normalized.entityType ?? undefined} onValueChange={(entityType) => updateSettings({ ...normalized, entityType, metricField: null, aggregate: 'count', groupByField: null, granularity: null })}>
            <SelectTrigger id="custom-metric-entity" size="sm"><SelectValue placeholder={t('dashboards.widgets.customMetric.settings.entity')} /></SelectTrigger>
            <SelectContent>{catalog.map((item) => <SelectItem key={item.entityType} value={item.entityType}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-metric-field" className="text-xs font-semibold uppercase text-muted-foreground">{t('dashboards.widgets.customMetric.settings.field')}</Label>
          <Select value={normalized.metricField ?? undefined} disabled={!entity} onValueChange={(metricField) => updateSettings({ ...normalized, metricField })}>
            <SelectTrigger id="custom-metric-field" size="sm"><SelectValue placeholder={t('dashboards.widgets.customMetric.settings.field')} /></SelectTrigger>
            <SelectContent>{metricOptions.map((field) => <SelectItem key={field.field} value={field.field}>{field.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-metric-aggregate" className="text-xs font-semibold uppercase text-muted-foreground">{t('dashboards.widgets.customMetric.settings.aggregate')}</Label>
          <Select value={normalized.aggregate} onValueChange={(aggregate) => updateSettings({ ...normalized, aggregate: aggregate as AggregateFunction })}>
            <SelectTrigger id="custom-metric-aggregate" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>{aggregateOptions.map((aggregate) => <SelectItem key={aggregate} value={aggregate}>{t(`dashboards.widgets.customMetric.settings.aggregate.${aggregate}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="custom-metric-visualization" className="text-xs font-semibold uppercase text-muted-foreground">{t('dashboards.widgets.customMetric.settings.visualization')}</Label>
          <Select value={normalized.visualization} onValueChange={(visualization) => updateSettings({ ...normalized, visualization: visualization as CustomMetricVisualization })}>
            <SelectTrigger id="custom-metric-visualization" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>{VISUALIZATIONS.map((visualization) => <SelectItem key={visualization} value={visualization} disabled={(visualization === 'line' && !hasTimestampGroup) || ((visualization === 'bar' || visualization === 'donut' || visualization === 'table') && !hasCategoricalGroup)}>{t(`dashboards.widgets.customMetric.settings.visualization.${visualization}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {normalized.visualization !== 'kpi' ? (
          <div className="space-y-1.5">
            <Label htmlFor="custom-metric-group-by" className="text-xs font-semibold uppercase text-muted-foreground">{t('dashboards.widgets.customMetric.settings.groupBy')}</Label>
            <Select value={normalized.groupByField ?? undefined} disabled={!currentGroupFields.length} onValueChange={(groupByField) => updateSettings({ ...normalized, groupByField })}>
              <SelectTrigger id="custom-metric-group-by" size="sm"><SelectValue placeholder={t('dashboards.widgets.customMetric.settings.groupBy')} /></SelectTrigger>
              <SelectContent>{currentGroupFields.map((field) => <SelectItem key={field.field} value={field.field}>{field.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : null}
        {selectedGroup?.kind === 'timestamp' ? (
          <div className="space-y-1.5">
            <Label htmlFor="custom-metric-granularity" className="text-xs font-semibold uppercase text-muted-foreground">{t('dashboards.widgets.customMetric.settings.granularity')}</Label>
            <Select value={normalized.granularity ?? 'day'} onValueChange={(granularity) => updateSettings({ ...normalized, granularity: granularity as DateGranularity })}>
              <SelectTrigger id="custom-metric-granularity" size="sm"><SelectValue /></SelectTrigger>
              <SelectContent>{GRANULARITY_OPTIONS.map((granularity) => <SelectItem key={granularity} value={granularity}>{t(`dashboards.analytics.granularity.${granularity}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : null}
        {(normalized.visualization === 'bar' || normalized.visualization === 'donut' || normalized.visualization === 'table') ? (
          <div className="space-y-1.5">
            <Label htmlFor="custom-metric-limit" className="text-xs font-semibold uppercase text-muted-foreground">{t('dashboards.widgets.customMetric.settings.limit')}</Label>
            <Input id="custom-metric-limit" type="number" min={1} max={20} className="w-24" value={normalized.limit} onChange={(event) => updateSettings({ ...normalized, limit: clampLimit(Number(event.target.value)) })} />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="custom-metric-date-range-mode" className="text-xs font-semibold uppercase text-muted-foreground">{t('dashboards.widgets.dateRange.mode.label')}</Label>
          <Select value={normalized.dateRangeMode} onValueChange={(dateRangeMode) => updateSettings({ ...normalized, dateRangeMode: dateRangeMode as 'global' | 'custom' })}>
            <SelectTrigger id="custom-metric-date-range-mode" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="global">{t('dashboards.widgets.dateRange.mode.global')}</SelectItem><SelectItem value="custom">{t('dashboards.widgets.dateRange.mode.custom')}</SelectItem></SelectContent>
          </Select>
        </div>
        {showPreset ? <DateRangeSelect id="custom-metric-date-range" value={normalized.dateRangePreset ?? DEFAULT_DATE_RANGE_PRESET} onChange={(dateRangePreset) => updateSettings({ ...normalized, dateRangePreset })} /> : null}
        <div className="space-y-1.5">
          <Label htmlFor="custom-metric-title" className="text-xs font-semibold uppercase text-muted-foreground">{t('dashboards.widgets.customMetric.settings.title')}</Label>
          <Input id="custom-metric-title" value={normalized.title} placeholder={t('dashboards.widgets.customMetric.settings.titlePlaceholder')} onChange={(event) => updateSettings({ ...normalized, title: event.target.value })} />
        </div>
      </div>
    )
  }

  if (catalogLoading) return <KpiCard value={null} loading />
  if (catalogError) return <KpiCard value={null} error={catalogError} />
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
