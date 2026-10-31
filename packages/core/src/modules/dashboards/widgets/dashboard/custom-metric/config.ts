import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'
import {
  type AggregateFunction,
  type DateGranularity,
  isValidAggregate,
  isValidGranularity,
} from '../../../lib/aggregations'

export type CustomMetricVisualization = 'kpi' | 'line' | 'bar' | 'donut' | 'table'
export type CustomMetricDateRangeMode = 'global' | 'custom'

export type CustomMetricSettings = {
  entityType: string | null
  metricField: string | null
  aggregate: AggregateFunction
  groupByField: string | null
  granularity: DateGranularity | null
  limit: number
  visualization: CustomMetricVisualization
  title: string
  dateRangeMode: CustomMetricDateRangeMode
  dateRangePreset: DateRangePreset | null
}

export const DEFAULT_SETTINGS: CustomMetricSettings = {
  entityType: null,
  metricField: null,
  aggregate: 'count',
  groupByField: null,
  granularity: null,
  limit: 10,
  visualization: 'kpi',
  title: '',
  dateRangeMode: 'global',
  dateRangePreset: null,
}

const VISUALIZATIONS: readonly CustomMetricVisualization[] = ['kpi', 'line', 'bar', 'donut', 'table']

function cleanOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isVisualization(value: unknown): value is CustomMetricVisualization {
  return typeof value === 'string' && VISUALIZATIONS.includes(value as CustomMetricVisualization)
}

function normalizeLimit(value: unknown): number {
  const limit = Number(value)
  if (!Number.isFinite(limit)) return DEFAULT_SETTINGS.limit
  return Math.min(20, Math.max(1, Math.floor(limit)))
}

export function hydrateSettings(raw: unknown): CustomMetricSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>

  return {
    entityType: cleanOptionalString(obj.entityType),
    metricField: cleanOptionalString(obj.metricField),
    aggregate: isValidAggregate(obj.aggregate) ? obj.aggregate : DEFAULT_SETTINGS.aggregate,
    groupByField: cleanOptionalString(obj.groupByField),
    granularity: isValidGranularity(obj.granularity) ? obj.granularity : null,
    limit: normalizeLimit(obj.limit),
    visualization: isVisualization(obj.visualization) ? obj.visualization : DEFAULT_SETTINGS.visualization,
    title: typeof obj.title === 'string' ? obj.title : DEFAULT_SETTINGS.title,
    dateRangeMode: obj.dateRangeMode === 'custom' ? 'custom' : DEFAULT_SETTINGS.dateRangeMode,
    dateRangePreset: isValidDateRangePreset(obj.dateRangePreset) ? obj.dateRangePreset : null,
  }
}
