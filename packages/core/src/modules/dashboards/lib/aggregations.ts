import type { AnalyticsRegistry } from '../services/analyticsRegistry'
import type { AnalyticsEntityTypeConfig, AnalyticsFieldMapping } from '@open-mercato/shared/modules/analytics'

export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type DateGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year'

const VALID_GRANULARITIES: readonly DateGranularity[] = ['day', 'week', 'month', 'quarter', 'year']
const VALID_AGGREGATES: readonly AggregateFunction[] = ['count', 'sum', 'avg', 'min', 'max']
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function isValidGranularity(value: unknown): value is DateGranularity {
  return typeof value === 'string' && VALID_GRANULARITIES.includes(value as DateGranularity)
}

export function isValidAggregate(value: unknown): value is AggregateFunction {
  return typeof value === 'string' && VALID_AGGREGATES.includes(value as AggregateFunction)
}

function isSafeIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER_PATTERN.test(value)
}

// Re-export types from shared module for convenience
export type EntityTypeConfig = AnalyticsEntityTypeConfig
export type FieldMapping = AnalyticsFieldMapping

export function buildAggregateExpression(aggregate: AggregateFunction, column: string): string {
  switch (aggregate) {
    case 'count':
      return column === 'id' ? 'COUNT(*)' : `COUNT(${column})`
    case 'sum':
      return `COALESCE(SUM(${column}::numeric), 0)`
    case 'avg':
      return `COALESCE(AVG(${column}::numeric), 0)`
    case 'min':
      return `MIN(${column}::numeric)`
    case 'max':
      return `MAX(${column}::numeric)`
    default:
      return `COUNT(*)`
  }
}

export function buildDateTruncExpression(column: string, granularity: DateGranularity): string {
  if (!isValidGranularity(granularity)) {
    throw new Error(`Invalid granularity: ${granularity}`)
  }
  return `DATE_TRUNC('${granularity}', ${column})`
}

export function buildJsonbFieldExpression(column: string, path: string): string {
  const parts = path.split('.')
  for (const part of parts) {
    if (!isSafeIdentifier(part)) {
      throw new Error(`Invalid JSONB path part: ${part}`)
    }
  }
  if (parts.length === 1) {
    return `${column}->>'${parts[0]}'`
  }
  const intermediate = parts.slice(0, -1).map((p) => `'${p}'`).join('->')
  const lastPart = parts[parts.length - 1]
  return `${column}->${intermediate}->>'${lastPart}'`
}

export type AggregationQuery = {
  sql: string
  params: unknown[]
}

export type BuildAggregationQueryOptions = {
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
  dateRange?: {
    field: string
    start: Date
    end: Date
  }
  filters?: Array<{
    field: string
    operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'is_null' | 'is_not_null'
    value?: unknown
  }>
  scope: {
    tenantId: string
    organizationIds?: string[]
  }
  /** Analytics registry for resolving entity and field configurations */
  registry: AnalyticsRegistry
}

export function buildAggregationQuery(options: BuildAggregationQueryOptions): AggregationQuery | null {
  const { registry } = options
  const config = registry.getEntityTypeConfig(options.entityType)
  if (!config) return null

  const metricMapping = registry.getFieldMapping(options.entityType, options.metric.field)
  if (!metricMapping) return null

  const params: unknown[] = []

  const tableName = config.schema ? `"${config.schema}"."${config.tableName}"` : `"${config.tableName}"`
  const aggregateExpr = buildAggregateExpression(options.metric.aggregate, metricMapping.dbColumn)

  let selectClause = `SELECT ${aggregateExpr} AS value`
  let groupByClause = ''
  let orderByClause = ''
  let limitClause = ''

  if (options.groupBy) {
    let groupMapping = registry.getFieldMapping(options.entityType, options.groupBy.field)
    let groupExpr: string | null = null

    // Handle JSONB path notation (e.g., shippingAddressSnapshot.region)
    if (!groupMapping && options.groupBy.field.includes('.')) {
      const [baseField, ...pathParts] = options.groupBy.field.split('.')
      const baseMapping = registry.getFieldMapping(options.entityType, baseField)
      if (baseMapping?.type === 'jsonb') {
        groupExpr = buildJsonbFieldExpression(baseMapping.dbColumn, pathParts.join('.'))
      }
    } else if (groupMapping) {
      if (groupMapping.type === 'timestamp' && options.groupBy.granularity) {
        groupExpr = buildDateTruncExpression(groupMapping.dbColumn, options.groupBy.granularity)
      } else {
        groupExpr = groupMapping.dbColumn
      }
    }

    if (groupExpr) {
      selectClause = `SELECT ${groupExpr} AS group_key, ${aggregateExpr} AS value`
      groupByClause = `GROUP BY ${groupExpr}`
      orderByClause = `ORDER BY value DESC`

      if (options.groupBy.limit && options.groupBy.limit > 0) {
        limitClause = `LIMIT ${Math.min(options.groupBy.limit, 100)}`
      }
    }
  }

  const whereClauses: string[] = []

  whereClauses.push(`tenant_id = ?`)
  params.push(options.scope.tenantId)

  if (options.scope.organizationIds && options.scope.organizationIds.length > 0) {
    whereClauses.push(`organization_id = ANY(?::uuid[])`)
    params.push(`{${options.scope.organizationIds.join(',')}}`)
  }

  whereClauses.push(`deleted_at IS NULL`)

  if (options.dateRange) {
    const dateMapping = registry.getFieldMapping(options.entityType, options.dateRange.field)
    if (dateMapping) {
      whereClauses.push(`${dateMapping.dbColumn} >= ?`)
      params.push(options.dateRange.start)
      whereClauses.push(`${dateMapping.dbColumn} <= ?`)
      params.push(options.dateRange.end)
    }
  }

  if (options.filters) {
    for (const filter of options.filters) {
      const filterMapping = registry.getFieldMapping(options.entityType, filter.field)
      if (!filterMapping) continue

      switch (filter.operator) {
        case 'eq':
          whereClauses.push(`${filterMapping.dbColumn} = ?`)
          params.push(filter.value)
          break
        case 'neq':
          whereClauses.push(`${filterMapping.dbColumn} != ?`)
          params.push(filter.value)
          break
        case 'gt':
          whereClauses.push(`${filterMapping.dbColumn} > ?`)
          params.push(filter.value)
          break
        case 'gte':
          whereClauses.push(`${filterMapping.dbColumn} >= ?`)
          params.push(filter.value)
          break
        case 'lt':
          whereClauses.push(`${filterMapping.dbColumn} < ?`)
          params.push(filter.value)
          break
        case 'lte':
          whereClauses.push(`${filterMapping.dbColumn} <= ?`)
          params.push(filter.value)
          break
        case 'in':
          whereClauses.push(`${filterMapping.dbColumn} = ANY(?)`)
          params.push(filter.value)
          break
        case 'not_in':
          whereClauses.push(`${filterMapping.dbColumn} != ALL(?)`)
          params.push(filter.value)
          break
        case 'is_null':
          whereClauses.push(`${filterMapping.dbColumn} IS NULL`)
          break
        case 'is_not_null':
          whereClauses.push(`${filterMapping.dbColumn} IS NOT NULL`)
          break
      }
    }
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  const sql = [selectClause, `FROM ${tableName}`, whereClause, groupByClause, orderByClause, limitClause]
    .filter(Boolean)
    .join(' ')

  return { sql, params }
}
