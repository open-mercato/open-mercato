import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'
import type { WidgetDataRequest } from '../../../services/widgetDataService'

export const CLOSED_DEAL_STATUSES = ['win', 'loose'] as const

export const PIPELINE_STATUS_SCOPES = ['open', 'all'] as const

export type PipelineStatusScope = typeof PIPELINE_STATUS_SCOPES[number]

export type PipelineSummarySettings = {
  dateRange: DateRangePreset
  statusScope: PipelineStatusScope
}

export const DEFAULT_SETTINGS: PipelineSummarySettings = {
  dateRange: 'this_month',
  statusScope: 'open',
}

function isValidStatusScope(value: unknown): value is PipelineStatusScope {
  return typeof value === 'string' && (PIPELINE_STATUS_SCOPES as readonly string[]).includes(value)
}

export function hydrateSettings(raw: unknown): PipelineSummarySettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
    statusScope: isValidStatusScope(obj.statusScope) ? obj.statusScope : DEFAULT_SETTINGS.statusScope,
  }
}

export function buildPipelineDataRequest(settings: PipelineSummarySettings): WidgetDataRequest {
  const request: WidgetDataRequest = {
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

  if (settings.statusScope === 'open') {
    request.filters = CLOSED_DEAL_STATUSES.map((status) => ({
      field: 'status',
      operator: 'neq' as const,
      value: status,
    }))
  }

  return request
}
