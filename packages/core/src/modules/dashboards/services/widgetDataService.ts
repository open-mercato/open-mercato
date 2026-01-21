import type { EntityManager } from '@mikro-orm/postgresql'
import {
  type DateRangePreset,
  resolveDateRange,
  getPreviousPeriod,
  calculatePercentageChange,
  determineChangeDirection,
  isValidDateRangePreset,
} from '../lib/dateRanges'
import {
  type AggregateFunction,
  type DateGranularity,
  buildAggregationQuery,
  isValidEntityType,
  getFieldMapping,
} from '../lib/aggregations'

export type WidgetDataRequest = {
  entityType: string
  metric: {
    field: string
    aggregate: AggregateFunction
  }
  groupBy?: {
    field: string
    granularity?: DateGranularity
    limit?: number
  }
  filters?: Array<{
    field: string
    operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'is_null' | 'is_not_null'
    value?: unknown
  }>
  dateRange?: {
    field: string
    preset: DateRangePreset
  }
  comparison?: {
    type: 'previous_period' | 'previous_year'
  }
}

export type WidgetDataItem = {
  groupKey: unknown
  value: number | null
}

export type WidgetDataResponse = {
  value: number | null
  data: WidgetDataItem[]
  comparison?: {
    value: number | null
    change: number
    direction: 'up' | 'down' | 'unchanged'
  }
  metadata: {
    fetchedAt: string
    recordCount: number
  }
}

export type WidgetDataScope = {
  tenantId: string
  organizationIds?: string[]
}

export type WidgetDataServiceOptions = {
  em: EntityManager
  scope: WidgetDataScope
}

export class WidgetDataService {
  private em: EntityManager
  private scope: WidgetDataScope

  constructor(options: WidgetDataServiceOptions) {
    this.em = options.em
    this.scope = options.scope
  }

  async fetchWidgetData(request: WidgetDataRequest): Promise<WidgetDataResponse> {
    this.validateRequest(request)

    const now = new Date()
    let dateRangeResolved: { start: Date; end: Date } | undefined
    let comparisonRange: { start: Date; end: Date } | undefined

    if (request.dateRange) {
      dateRangeResolved = resolveDateRange(request.dateRange.preset, now)
      if (request.comparison) {
        comparisonRange = getPreviousPeriod(dateRangeResolved, request.dateRange.preset)
      }
    }

    const mainResult = await this.executeQuery(request, dateRangeResolved)

    let comparisonResult: { value: number | null; data: WidgetDataItem[] } | undefined
    if (comparisonRange && request.dateRange) {
      comparisonResult = await this.executeQuery(request, comparisonRange)
    }

    const response: WidgetDataResponse = {
      value: mainResult.value,
      data: mainResult.data,
      metadata: {
        fetchedAt: now.toISOString(),
        recordCount: mainResult.data.length || (mainResult.value !== null ? 1 : 0),
      },
    }

    if (comparisonResult && mainResult.value !== null && comparisonResult.value !== null) {
      response.comparison = {
        value: comparisonResult.value,
        change: calculatePercentageChange(mainResult.value, comparisonResult.value),
        direction: determineChangeDirection(mainResult.value, comparisonResult.value),
      }
    }

    return response
  }

  private validateRequest(request: WidgetDataRequest): void {
    if (!isValidEntityType(request.entityType)) {
      throw new Error(`Invalid entity type: ${request.entityType}`)
    }

    if (!request.metric?.field || !request.metric?.aggregate) {
      throw new Error('Metric field and aggregate are required')
    }

    const metricMapping = getFieldMapping(request.entityType, request.metric.field)
    if (!metricMapping) {
      throw new Error(`Invalid metric field: ${request.metric.field} for entity type: ${request.entityType}`)
    }

    const validAggregates: AggregateFunction[] = ['count', 'sum', 'avg', 'min', 'max']
    if (!validAggregates.includes(request.metric.aggregate)) {
      throw new Error(`Invalid aggregate function: ${request.metric.aggregate}`)
    }

    if (request.dateRange && !isValidDateRangePreset(request.dateRange.preset)) {
      throw new Error(`Invalid date range preset: ${request.dateRange.preset}`)
    }

    if (request.groupBy) {
      const groupMapping = getFieldMapping(request.entityType, request.groupBy.field)
      if (!groupMapping) {
        const [baseField] = request.groupBy.field.split('.')
        const baseMapping = getFieldMapping(request.entityType, baseField)
        if (!baseMapping || baseMapping.type !== 'jsonb') {
          throw new Error(`Invalid groupBy field: ${request.groupBy.field}`)
        }
      }
    }
  }

  private async executeQuery(
    request: WidgetDataRequest,
    dateRange?: { start: Date; end: Date },
  ): Promise<{ value: number | null; data: WidgetDataItem[] }> {
    const query = buildAggregationQuery({
      entityType: request.entityType,
      metric: request.metric,
      groupBy: request.groupBy,
      dateRange: dateRange && request.dateRange ? { field: request.dateRange.field, ...dateRange } : undefined,
      filters: request.filters,
      scope: this.scope,
    })

    if (!query) {
      throw new Error('Failed to build aggregation query')
    }

    const rows = await this.em.getConnection().execute(query.sql, query.params)
    const results = Array.isArray(rows) ? rows : []

    if (request.groupBy) {
      const data = results.map((row: Record<string, unknown>) => ({
        groupKey: row.group_key,
        value: row.value !== null ? Number(row.value) : null,
      }))
      const totalValue = data.reduce((sum: number, item: { value: number | null }) => sum + (item.value ?? 0), 0)
      return { value: totalValue, data }
    }

    const singleValue = results[0]?.value !== undefined ? Number(results[0].value) : null
    return { value: singleValue, data: [] }
  }
}

export function createWidgetDataService(em: EntityManager, scope: WidgetDataScope): WidgetDataService {
  return new WidgetDataService({ em, scope })
}
