import type { AnalyticsRegistry } from '../services/analyticsRegistry'
import type { AnalyticsEntityTypeConfig, AnalyticsFieldMapping } from '@open-mercato/shared/modules/analytics'
import { assertSafeIdentifier, isSafeIdentifier, readOwnProperty } from './identifiers'

export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type DateGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year'

const VALID_GRANULARITIES: readonly DateGranularity[] = ['day', 'week', 'month', 'quarter', 'year']
const VALID_AGGREGATES: readonly AggregateFunction[] = ['count', 'sum', 'avg', 'min', 'max']

export function isValidGranularity(value: unknown): value is DateGranularity {
  return typeof value === 'string' && VALID_GRANULARITIES.includes(value as DateGranularity)
}

export function isValidAggregate(value: unknown): value is AggregateFunction {
  return typeof value === 'string' && VALID_AGGREGATES.includes(value as AggregateFunction)
}

// Re-export types from shared module for convenience
export type EntityTypeConfig = AnalyticsEntityTypeConfig
export type FieldMapping = AnalyticsFieldMapping

export function buildAggregateExpression(aggregate: AggregateFunction, column: string): string {
  if (!isValidAggregate(aggregate)) {
    throw new Error(`Invalid aggregate: ${String(aggregate)}`)
  }
  const safeColumn = assertSafeIdentifier(column, 'column name')
  switch (aggregate) {
    case 'count':
      return safeColumn === 'id' ? 'COUNT(*)' : `COUNT(${safeColumn})`
    case 'sum':
      return `COALESCE(SUM(${safeColumn}::numeric), 0)`
    case 'avg':
      return `COALESCE(AVG(${safeColumn}::numeric), 0)`
    case 'min':
      return `MIN(${safeColumn}::numeric)`
    case 'max':
      return `MAX(${safeColumn}::numeric)`
  }
}

export function buildDateTruncExpression(column: string, granularity: DateGranularity): string {
  if (!isValidGranularity(granularity)) {
    throw new Error(`Invalid granularity: ${granularity}`)
  }
  const safeColumn = assertSafeIdentifier(column, 'column name')
  return `DATE_TRUNC('${granularity}', ${safeColumn})`
}

export function buildJsonbFieldExpression(column: string, path: string): string {
  const safeColumn = assertSafeIdentifier(column, 'column name')
  const parts = path.split('.')
  for (const part of parts) {
    if (!isSafeIdentifier(part)) {
      throw new Error(`Invalid JSONB path part: ${part}`)
    }
  }
  if (parts.length === 1) {
    return `${safeColumn}->>'${parts[0]}'`
  }
  const intermediate = parts.slice(0, -1).map((p) => `'${p}'`).join('->')
  const lastPart = parts[parts.length - 1]
  return `${safeColumn}->${intermediate}->>'${lastPart}'`
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
    if (readOwnProperty(baseMapping, 'type') !== 'jsonb') return null
    const baseColumn = assertSafeIdentifier(readOwnProperty(baseMapping, 'dbColumn'), 'column name')
    const jsonPath = pathParts.join('.')
    return {
      expression: buildJsonbFieldExpression(baseColumn, jsonPath),
      dbColumn: baseColumn,
      jsonPath,
    }
  }

  if (!groupMapping) return null

  const groupColumn = assertSafeIdentifier(readOwnProperty(groupMapping, 'dbColumn'), 'column name')
  const groupType = readOwnProperty(groupMapping, 'type')

  if (groupType === 'timestamp' && groupBy.granularity) {
    return {
      expression: buildDateTruncExpression(groupColumn, groupBy.granularity),
      dbColumn: groupColumn,
      jsonPath: null,
    }
  }

  return { expression: groupColumn, dbColumn: groupColumn, jsonPath: null }
}

/**
 * Normalizes the value of a set filter (`in` / `not_in`) into the list of members it selects.
 *
 * The list is rendered as one placeholder per member rather than as a single array parameter:
 * MikroORM does not bind parameters at the driver level — `AbstractSqlConnection.execute` calls
 * `platform.formatQuery`, which interpolates each value through `BasePostgreSqlPlatform.escape`,
 * and that renders a JavaScript array as a bare comma-separated list. The previous
 * `= ANY(?)` / `!= ALL(?)` form therefore produced `= ANY('a', 'b')`, which PostgreSQL rejects
 * for every shape of value (#4669).
 *
 * A missing value yields an empty set rather than a dropped filter, so an `in` filter the caller
 * failed to populate selects nothing instead of silently widening the result.
 *
 * A null or undefined *member* is refused instead of rendered. `column IN (NULL)` matches no row
 * and `column NOT IN ('a', NULL)` is NULL for every row, so such a member would return an empty
 * aggregation with no error — a silent zero on a reporting surface, which is worse than a loud
 * failure. Requests are already rejected at the API boundary by `widgetDataFilterSchema` in
 * `api/widgets/data/schema.ts`; this throw keeps in-process callers, whose filter values are
 * typed as `unknown`, from reaching the same silent path. Nullness is queried with the dedicated
 * `is_null` / `is_not_null` operators.
 */
function normalizeSetFilterValues(value: unknown): unknown[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value]
  if (values.some((member) => member === null || member === undefined)) {
    throw new Error(
      '[internal] Set filter members must not be null or undefined — use the is_null / is_not_null operators to filter on nullness',
    )
  }
  return values
}

/**
 * Builds the shared WHERE clause every aggregation query reads from, together with its parameters.
 *
 * The `eq` / `neq` cases branch on a null value instead of binding it (#5016). Under SQL
 * three-valued logic neither `column = NULL` nor `column != NULL` is ever `TRUE`, so binding a raw
 * null selected zero rows and rendered as a legitimate-looking empty aggregation — a silent zero on
 * a reporting surface. Nullness has to be asked with the `IS NULL` / `IS NOT NULL` keywords, which
 * take no parameter; that is also what the dedicated `is_null` / `is_not_null` operators emit, and
 * it mirrors how the query index builds column filters (`query_index/lib/engine.ts`).
 *
 * The ordering operators (`gt`/`gte`/`lt`/`lte`) deliberately keep binding the value: comparing an
 * ordering against NULL is genuinely undefined rather than a mistake, so their never-`TRUE` result
 * is the correct answer. Set operators refuse null members outright — see
 * `normalizeSetFilterValues`.
 */
function buildWhereClause(
  options: Pick<BuildAggregationQueryOptions, 'entityType' | 'dateRange' | 'filters' | 'scope' | 'registry'>,
): { clause: string; params: unknown[] } {
  const { registry } = options
  const params: unknown[] = []
  const whereClauses: string[] = []

  whereClauses.push(`tenant_id = ?`)
  params.push(options.scope.tenantId)

  if (options.scope.organizationIds !== undefined) {
    whereClauses.push(`organization_id = ANY(?::uuid[])`)
    params.push(`{${options.scope.organizationIds.join(',')}}`)
  }

  whereClauses.push(`deleted_at IS NULL`)

  if (options.dateRange) {
    const dateMapping = registry.getFieldMapping(options.entityType, options.dateRange.field)
    if (dateMapping) {
      const dateColumn = assertSafeIdentifier(readOwnProperty(dateMapping, 'dbColumn'), 'column name')
      whereClauses.push(`${dateColumn} >= ?`)
      params.push(options.dateRange.start)
      whereClauses.push(`${dateColumn} <= ?`)
      params.push(options.dateRange.end)
    }
  }

  if (options.filters) {
    for (const filter of options.filters) {
      const filterMapping = registry.getFieldMapping(options.entityType, filter.field)
      if (!filterMapping) continue
      const filterColumn = assertSafeIdentifier(readOwnProperty(filterMapping, 'dbColumn'), 'column name')

      switch (filter.operator) {
        case 'eq':
          if (filter.value === null) {
            whereClauses.push(`${filterColumn} IS NULL`)
            break
          }
          whereClauses.push(`${filterColumn} = ?`)
          params.push(filter.value)
          break
        case 'neq':
          if (filter.value === null) {
            whereClauses.push(`${filterColumn} IS NOT NULL`)
            break
          }
          whereClauses.push(`${filterColumn} != ?`)
          params.push(filter.value)
          break
        case 'gt':
          whereClauses.push(`${filterColumn} > ?`)
          params.push(filter.value)
          break
        case 'gte':
          whereClauses.push(`${filterColumn} >= ?`)
          params.push(filter.value)
          break
        case 'lt':
          whereClauses.push(`${filterColumn} < ?`)
          params.push(filter.value)
          break
        case 'lte':
          whereClauses.push(`${filterColumn} <= ?`)
          params.push(filter.value)
          break
        case 'in':
        case 'not_in': {
          const values = normalizeSetFilterValues(filter.value)
          if (values.length === 0) {
            whereClauses.push(filter.operator === 'in' ? 'FALSE' : 'TRUE')
            break
          }
          const keyword = filter.operator === 'in' ? 'IN' : 'NOT IN'
          const placeholders = values.map(() => '?').join(', ')
          whereClauses.push(`${filterColumn} ${keyword} (${placeholders})`)
          params.push(...values)
          break
        }
        case 'is_null':
          whereClauses.push(`${filterColumn} IS NULL`)
          break
        case 'is_not_null':
          whereClauses.push(`${filterColumn} IS NOT NULL`)
          break
      }
    }
  }

  return { clause: whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '', params }
}

function resolveTableName(config: EntityTypeConfig): string {
  const tableName = assertSafeIdentifier(readOwnProperty(config, 'tableName'), 'table name')
  const schema = readOwnProperty(config, 'schema')
  if (schema !== undefined) {
    assertSafeIdentifier(schema, 'schema name')
    return `"${schema}"."${tableName}"`
  }
  return `"${tableName}"`
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
  const currencyField = readOwnProperty(config, 'currencyField')
  if (!config || typeof currencyField !== 'string' || !currencyField) return null

  const currencyMapping = registry.getFieldMapping(options.entityType, currencyField)
  if (!currencyMapping) return null
  const currencyColumn = assertSafeIdentifier(readOwnProperty(currencyMapping, 'dbColumn'), 'currency column')

  const tableName = resolveTableName(config)
  const where = buildWhereClause(options)
  const normalizedCurrencyExpression = `UPPER(NULLIF(BTRIM(${currencyColumn}), ''))`
  const sql = [
    `SELECT DISTINCT ${normalizedCurrencyExpression} AS code`,
    `FROM ${tableName}`,
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
  const metricColumn = assertSafeIdentifier(readOwnProperty(metricMapping, 'dbColumn'), 'column name')
  const aggregateExpr = buildAggregateExpression(options.metric.aggregate, metricColumn)

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

  const groupColumn = assertSafeIdentifier(options.groupColumn, 'group column')
  const metricColumn = assertSafeIdentifier(readOwnProperty(metricMapping, 'dbColumn'), 'column name')
  const tableName = resolveTableName(config)

  const where = buildWhereClause(options)
  const sql = [
    `SELECT ${groupColumn} AS group_source, ${metricColumn} AS metric_value`,
    `FROM ${tableName}`,
    where.clause,
    `LIMIT ${Math.max(1, Math.floor(options.rowLimit)) + 1}`,
  ]
    .filter(Boolean)
    .join(' ')

  return { sql, params: where.params }
}
