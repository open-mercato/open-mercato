"use client"

import * as React from 'react'
import type { DashboardWidgetRenderContext } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { DateRangePreset } from '@open-mercato/ui/backend/date-range'
import type { CustomMetricSettings, CustomMetricVisualization } from './config'
import type { AggregateFunction, DateGranularity } from '../../../lib/aggregations'
import type { WidgetDataRequest } from '../../../services/widgetDataService'

export type CatalogField = {
  field: string
  label: string
  kind: 'numeric' | 'text' | 'uuid' | 'timestamp' | 'jsonb'
  aggregates: AggregateFunction[]
  groupable: boolean
}

export type CatalogEntity = {
  entityType: string
  label: string
  dateField: string | null
  fields: CatalogField[]
}

type CatalogResponse = { entities: CatalogEntity[] }

export const DEFAULT_DATE_RANGE_PRESET: DateRangePreset = 'last_30_days'
export const GRANULARITY_OPTIONS: DateGranularity[] = ['day', 'week', 'month', 'quarter', 'year']
export const VISUALIZATIONS: CustomMetricVisualization[] = ['kpi', 'line', 'bar', 'donut', 'table']

export function clampLimit(limit: number): number {
  return Math.min(20, Math.max(1, Math.floor(limit)))
}

function isCategoricalField(field: CatalogField): boolean {
  return field.groupable && (field.kind === 'text' || field.kind === 'uuid')
}

export function metricFields(entity: CatalogEntity | null, aggregate: AggregateFunction): CatalogField[] {
  if (!entity) return []
  return aggregate === 'count' ? entity.fields : entity.fields.filter((field) => field.kind === 'numeric')
}

export function groupFields(entity: CatalogEntity | null, visualization: CustomMetricVisualization): CatalogField[] {
  if (!entity || visualization === 'kpi') return []
  if (visualization === 'line') return entity.fields.filter((field) => field.groupable && field.kind === 'timestamp')
  return entity.fields.filter(isCategoricalField)
}

export function findField(entity: CatalogEntity | null, fieldName: string | null): CatalogField | null {
  return entity?.fields.find((field) => field.field === fieldName) ?? null
}

function firstMetricField(entity: CatalogEntity, aggregate: AggregateFunction): string | null {
  if (aggregate === 'count') {
    return entity.fields.find((field) => field.field === 'id')?.field ?? entity.fields[0]?.field ?? null
  }
  return entity.fields.find((field) => field.kind === 'numeric')?.field ?? null
}

export function normalizeSettings(settings: CustomMetricSettings, catalog: CatalogEntity[]): CustomMetricSettings {
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

export function buildDateRange(
  settings: CustomMetricSettings,
  entity: CatalogEntity,
  context: DashboardWidgetRenderContext,
): WidgetDataRequest['dateRange'] | undefined {
  if (!entity.dateField) return undefined
  if (settings.dateRangeMode === 'global' && context.dateRange) {
    return { field: entity.dateField, from: context.dateRange.from, to: context.dateRange.to }
  }
  return { field: entity.dateField, preset: settings.dateRangePreset ?? DEFAULT_DATE_RANGE_PRESET }
}

export function buildComparison(
  settings: CustomMetricSettings,
  context: DashboardWidgetRenderContext,
): WidgetDataRequest['comparison'] | undefined {
  if (settings.visualization !== 'kpi' || settings.dateRangeMode !== 'global') return undefined
  const compare = context.dateRange?.compare
  return compare && compare !== 'none' ? { type: compare } : undefined
}

export function buildRequest(
  settings: CustomMetricSettings,
  entity: CatalogEntity | null,
  context: DashboardWidgetRenderContext,
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

export async function fetchCatalog(): Promise<CatalogEntity[]> {
  const call = await apiCall<CatalogResponse>('/api/dashboards/analytics/catalog')
  if (!call.ok || !call.result) throw new Error('[internal] custom-metric catalog load failed')
  return call.result.entities
}

export type CustomMetricAiResult = {
  config: Partial<CustomMetricSettings> | null
  aiAvailable: boolean
}

export async function generateCustomMetricConfig(prompt: string): Promise<CustomMetricAiResult> {
  const call = await apiCall<CustomMetricAiResult>('/api/dashboards/analytics/custom-metric/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!call.ok || !call.result) throw new Error('[internal] custom-metric AI request failed')
  return call.result
}

export type CustomMetricCatalogState = {
  catalog: CatalogEntity[]
  loading: boolean
  error: boolean
  reload: () => Promise<void>
}

export function useCustomMetricCatalog(): CustomMetricCatalogState {
  const [catalog, setCatalog] = React.useState<CatalogEntity[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)

  const reload = React.useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      setCatalog(await fetchCatalog())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    reload().catch(() => {})
  }, [reload])

  return { catalog, loading, error, reload }
}
