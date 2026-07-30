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

export type ScopedQueryOptions = {
  entityType: string
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
  registry: AnalyticsRegistry
}

function appendScopeWhereClauses(options: ScopedQueryOptions, params: unknown[]): { clauses: string[] } {
  const { registry } = options
  const clauses: string[] = []

  clauses.push(`tenant_id = ?`)
  params.push(options.scope.tenantId)

  if (options.scope.organizationIds && options.scope.organizationIds.length > 0) {
    clauses.push(`organization_id = ANY(?::uuid[])`)
    params.push(`{${options.scope.organizationIds.join(',')}}`)
  }

  clauses.push(`deleted_at IS NULL`)

  if (options.dateRange) {
    const dateMapping = registry.getFieldMapping(options.entityType, options.dateRange.field)
    if (dateMapping) {
      clauses.push(`${dateMapping.dbColumn} >= ?`)
      params.push(options.dateRange.start)
      clauses.push(`${dateMapping.dbColumn} <= ?`)
      params.push(options.dateRange.end)
    }
  }

  if (options.filters) {
    for (const filter of options.filters) {
      const filterMapping = registry.getFieldMapping(options.entityType, filter.field)
      if (!filterMapping) continue

      switch (filter.operator) {
        case 'eq':
          clauses.push(`${filterMapping.dbColumn} = ?`)
          params.push(filter.value)
          break
        case 'neq':
          clauses.push(`${filterMapping.dbColumn} != ?`)
          params.push(filter.value)
          break
        case 'gt':
          clauses.push(`${filterMapping.dbColumn} > ?`)
          params.push(filter.value)
          break
        case 'gte':
          clauses.push(`${filterMapping.dbColumn} >= ?`)
          params.push(filter.value)
          break
        case 'lt':
          clauses.push(`${filterMapping.dbColumn} < ?`)
          params.push(filter.value)
          break
        case 'lte':
          clauses.push(`${filterMapping.dbColumn} <= ?`)
          params.push(filter.value)
          break
        case 'in':
          clauses.push(`${filterMapping.dbColumn} = ANY(?)`)
          params.push(filter.value)
          break
        case 'not_in':
          clauses.push(`${filterMapping.dbColumn} != ALL(?)`)
          params.push(filter.value)
          break
        case 'is_null':
          clauses.push(`${filterMapping.dbColumn} IS NULL`)
          break
        case 'is_not_null':
          clauses.push(`${filterMapping.dbColumn} IS NOT NULL`)
          break
      }
    }
  }

  return { clauses }
}

export type BuildDistinctCurrencyQueryOptions = ScopedQueryOptions & {
  /** Upper bound on the codes read back; two is enough to tell "one" from "several". */
  limit?: number
}

/**
 * Builds the query that reads the distinct per-row currencies of the rows an aggregation
 * would sum, over exactly the same tenant/organization scope, date range and filters.
 * Returns `null` when the entity declares no `currencyField`, which means its amounts are
 * not per-row denominated and there is nothing to verify (#4676).
 */
export function buildDistinctCurrencyQuery(
  options: BuildDistinctCurrencyQueryOptions,
): AggregationQuery | null {
  const { registry } = options
  const config = registry.getEntityTypeConfig(options.entityType)
  if (!config?.currencyField) return null

  const currencyMapping = registry.getFieldMapping(options.entityType, config.currencyField)
  if (!currencyMapping || !isSafeIdentifier(currencyMapping.dbColumn)) return null

  const params: unknown[] = []
  const tableName = config.schema ? `"${config.schema}"."${config.tableName}"` : `"${config.tableName}"`
  const { clauses } = appendScopeWhereClauses(options, params)
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const limit = Math.max(2, Math.min(options.limit ?? 2, 10))

  const sql = [
    `SELECT DISTINCT ${currencyMapping.dbColumn} AS code`,
    `FROM ${tableName}`,
    whereClause,
    `LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join(' ')

  return { sql, params }
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

  const { clauses: whereClauses } = appendScopeWhereClauses(options, params)

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

  const sql = [selectClause, `FROM ${tableName}`, whereClause, groupByClause, orderByClause, limitClause]
    .filter(Boolean)
    .join(' ')

  return { sql, params }
}
