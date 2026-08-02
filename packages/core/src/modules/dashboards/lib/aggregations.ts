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

export type ResolvedGroupExpression = {
  expression: string
  /** Column the group expression reads from — the encryption map is keyed by this. */
  dbColumn: string
  /** JSONB path below `dbColumn`, when the groupBy field used path notation. */
  jsonPath: string | null
}

/**
 * Resolves the SQL expression a groupBy field maps to, together with the underlying column so
 * callers can decide whether the source is encrypted at rest before grouping over it (#4622).
 */
export function resolveGroupExpression(
  registry: AnalyticsRegistry,
  entityType: string,
  groupBy: { field: string; granularity?: DateGranularity },
): ResolvedGroupExpression | null {
  const groupMapping = registry.getFieldMapping(entityType, groupBy.field)

  // Handle JSONB path notation (e.g., shippingAddressSnapshot.region)
  if (!groupMapping && groupBy.field.includes('.')) {
    const [baseField, ...pathParts] = groupBy.field.split('.')
    const baseMapping = registry.getFieldMapping(entityType, baseField)
    if (baseMapping?.type !== 'jsonb') return null
    const jsonPath = pathParts.join('.')
    return {
      expression: buildJsonbFieldExpression(baseMapping.dbColumn, jsonPath),
      dbColumn: baseMapping.dbColumn,
      jsonPath,
    }
  }

  if (!groupMapping) return null

  if (groupMapping.type === 'timestamp' && groupBy.granularity) {
    return {
      expression: buildDateTruncExpression(groupMapping.dbColumn, groupBy.granularity),
      dbColumn: groupMapping.dbColumn,
      jsonPath: null,
    }
  }

  return { expression: groupMapping.dbColumn, dbColumn: groupMapping.dbColumn, jsonPath: null }
}

function buildWhereClause(
  options: Pick<BuildAggregationQueryOptions, 'entityType' | 'dateRange' | 'filters' | 'scope' | 'registry'>,
): { clause: string; params: unknown[] } {
  const { registry } = options
  const params: unknown[] = []
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

  return { clause: whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '', params }
}

function resolveTableName(config: EntityTypeConfig): string {
  return config.schema ? `"${config.schema}"."${config.tableName}"` : `"${config.tableName}"`
}

export type BuildDistinctCurrencyQueryOptions = Pick<
  BuildAggregationQueryOptions,
  'entityType' | 'dateRange' | 'filters' | 'scope' | 'registry'
>

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

  const where = buildWhereClause(options)
  const normalizedCurrencyExpression = `UPPER(NULLIF(BTRIM(${currencyMapping.dbColumn}), ''))`
  const sql = [
    `SELECT DISTINCT ${normalizedCurrencyExpression} AS code`,
    `FROM ${resolveTableName(config)}`,
    where.clause,
    'LIMIT 2',
  ]
    .filter(Boolean)
    .join(' ')

  return { sql, params: where.params }
}

export function buildAggregationQuery(options: BuildAggregationQueryOptions): AggregationQuery | null {
  const { registry } = options
  const config = registry.getEntityTypeConfig(options.entityType)
  if (!config) return null

  const metricMapping = registry.getFieldMapping(options.entityType, options.metric.field)
  if (!metricMapping) return null

  const tableName = resolveTableName(config)
  const aggregateExpr = buildAggregateExpression(options.metric.aggregate, metricMapping.dbColumn)

  let selectClause = `SELECT ${aggregateExpr} AS value`
  let groupByClause = ''
  let orderByClause = ''
  let limitClause = ''

  if (options.groupBy) {
    const resolved = resolveGroupExpression(registry, options.entityType, options.groupBy)

    if (resolved) {
      selectClause = `SELECT ${resolved.expression} AS group_key, ${aggregateExpr} AS value`
      groupByClause = `GROUP BY ${resolved.expression}`
      // NULLS LAST is stated explicitly (PostgreSQL defaults DESC to NULLS FIRST) so a group limit
      // keeps the highest-value buckets instead of the empty ones, and so the application-side
      // encrypted path can mirror the same ordering (#4622).
      orderByClause = `ORDER BY value DESC NULLS LAST`

      if (options.groupBy.limit && options.groupBy.limit > 0) {
        limitClause = `LIMIT ${Math.min(options.groupBy.limit, 100)}`
      }
    }
  }

  const where = buildWhereClause(options)

  const sql = [selectClause, `FROM ${tableName}`, where.clause, groupByClause, orderByClause, limitClause]
    .filter(Boolean)
    .join(' ')

  return { sql, params: where.params }
}

export type BuildGroupSourceRowsQueryOptions = Omit<BuildAggregationQueryOptions, 'groupBy'> & {
  /** Column holding the (encrypted) group source, resolved via `resolveGroupExpression`. */
  groupColumn: string
  /** Hard cap on scanned rows; callers fetch `rowLimit + 1` to detect overflow. */
  rowLimit: number
}

/**
 * Builds a per-row query for group sources that cannot be grouped in SQL because the column is
 * encrypted at rest. Returns the raw group source alongside the metric value so the caller can
 * decrypt, then aggregate in application code (#4622).
 */
export function buildGroupSourceRowsQuery(options: BuildGroupSourceRowsQueryOptions): AggregationQuery | null {
  const { registry } = options
  const config = registry.getEntityTypeConfig(options.entityType)
  if (!config) return null

  const metricMapping = registry.getFieldMapping(options.entityType, options.metric.field)
  if (!metricMapping) return null

  if (!isSafeIdentifier(options.groupColumn)) {
    throw new Error(`Invalid group column: ${options.groupColumn}`)
  }

  const where = buildWhereClause(options)
  const sql = [
    `SELECT ${options.groupColumn} AS group_source, ${metricMapping.dbColumn} AS metric_value`,
    `FROM ${resolveTableName(config)}`,
    where.clause,
    `LIMIT ${Math.max(1, Math.floor(options.rowLimit)) + 1}`,
  ]
    .filter(Boolean)
    .join(' ')

  return { sql, params: where.params }
}
