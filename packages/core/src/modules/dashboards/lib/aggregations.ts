import type { DateRange } from './dateRanges'

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

export type EntityTypeConfig = {
  tableName: string
  schema?: string
  dateField: string
  defaultScopeFields: string[]
}

export const ENTITY_TYPE_CONFIG: Record<string, EntityTypeConfig> = {
  'sales:orders': {
    tableName: 'sales_orders',
    dateField: 'placed_at',
    defaultScopeFields: ['tenant_id', 'organization_id'],
  },
  'sales:order_lines': {
    tableName: 'sales_order_lines',
    dateField: 'created_at',
    defaultScopeFields: ['tenant_id', 'organization_id'],
  },
  'customers:entities': {
    tableName: 'customer_entities',
    dateField: 'created_at',
    defaultScopeFields: ['tenant_id', 'organization_id'],
  },
  'customers:deals': {
    tableName: 'customer_deals',
    dateField: 'created_at',
    defaultScopeFields: ['tenant_id', 'organization_id'],
  },
  'catalog:products': {
    tableName: 'products',
    dateField: 'created_at',
    defaultScopeFields: ['tenant_id', 'organization_id'],
  },
}

export function isValidEntityType(entityType: string): boolean {
  return entityType in ENTITY_TYPE_CONFIG
}

export function getEntityTypeConfig(entityType: string): EntityTypeConfig | null {
  return ENTITY_TYPE_CONFIG[entityType] ?? null
}

export type FieldMapping = {
  dbColumn: string
  type: 'numeric' | 'text' | 'uuid' | 'timestamp' | 'jsonb'
}

export const FIELD_MAPPINGS: Record<string, Record<string, FieldMapping>> = {
  'sales:orders': {
    id: { dbColumn: 'id', type: 'uuid' },
    grandTotalGrossAmount: { dbColumn: 'grand_total_gross_amount', type: 'numeric' },
    grandTotalNetAmount: { dbColumn: 'grand_total_net_amount', type: 'numeric' },
    subtotalGrossAmount: { dbColumn: 'subtotal_gross_amount', type: 'numeric' },
    subtotalNetAmount: { dbColumn: 'subtotal_net_amount', type: 'numeric' },
    discountTotalAmount: { dbColumn: 'discount_total_amount', type: 'numeric' },
    taxTotalAmount: { dbColumn: 'tax_total_amount', type: 'numeric' },
    lineItemCount: { dbColumn: 'line_item_count', type: 'numeric' },
    status: { dbColumn: 'status', type: 'text' },
    fulfillmentStatus: { dbColumn: 'fulfillment_status', type: 'text' },
    paymentStatus: { dbColumn: 'payment_status', type: 'text' },
    customerEntityId: { dbColumn: 'customer_entity_id', type: 'uuid' },
    channelId: { dbColumn: 'channel_id', type: 'uuid' },
    placedAt: { dbColumn: 'placed_at', type: 'timestamp' },
    currencyCode: { dbColumn: 'currency_code', type: 'text' },
    shippingAddressSnapshot: { dbColumn: 'shipping_address_snapshot', type: 'jsonb' },
  },
  'sales:order_lines': {
    id: { dbColumn: 'id', type: 'uuid' },
    totalGrossAmount: { dbColumn: 'total_gross_amount', type: 'numeric' },
    totalNetAmount: { dbColumn: 'total_net_amount', type: 'numeric' },
    unitGrossPrice: { dbColumn: 'unit_gross_price', type: 'numeric' },
    quantity: { dbColumn: 'quantity', type: 'numeric' },
    productId: { dbColumn: 'product_id', type: 'uuid' },
    productVariantId: { dbColumn: 'product_variant_id', type: 'uuid' },
    status: { dbColumn: 'status', type: 'text' },
    createdAt: { dbColumn: 'created_at', type: 'timestamp' },
  },
  'customers:entities': {
    id: { dbColumn: 'id', type: 'uuid' },
    kind: { dbColumn: 'kind', type: 'text' },
    status: { dbColumn: 'status', type: 'text' },
    lifecycleStage: { dbColumn: 'lifecycle_stage', type: 'text' },
    createdAt: { dbColumn: 'created_at', type: 'timestamp' },
    displayName: { dbColumn: 'display_name', type: 'text' },
  },
  'customers:deals': {
    id: { dbColumn: 'id', type: 'uuid' },
    valueAmount: { dbColumn: 'value_amount', type: 'numeric' },
    status: { dbColumn: 'status', type: 'text' },
    pipelineStage: { dbColumn: 'pipeline_stage', type: 'text' },
    probability: { dbColumn: 'probability', type: 'numeric' },
    createdAt: { dbColumn: 'created_at', type: 'timestamp' },
    expectedCloseAt: { dbColumn: 'expected_close_at', type: 'timestamp' },
  },
  'catalog:products': {
    id: { dbColumn: 'id', type: 'uuid' },
    name: { dbColumn: 'name', type: 'text' },
    status: { dbColumn: 'status', type: 'text' },
    createdAt: { dbColumn: 'created_at', type: 'timestamp' },
  },
}

export function getFieldMapping(entityType: string, field: string): FieldMapping | null {
  return FIELD_MAPPINGS[entityType]?.[field] ?? null
}

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
}

export function buildAggregationQuery(options: BuildAggregationQueryOptions): AggregationQuery | null {
  const config = getEntityTypeConfig(options.entityType)
  if (!config) return null

  const metricMapping = getFieldMapping(options.entityType, options.metric.field)
  if (!metricMapping) return null

  const params: unknown[] = []

  const tableName = config.schema ? `"${config.schema}"."${config.tableName}"` : `"${config.tableName}"`
  const aggregateExpr = buildAggregateExpression(options.metric.aggregate, metricMapping.dbColumn)

  let selectClause = `SELECT ${aggregateExpr} AS value`
  let groupByClause = ''
  let orderByClause = ''
  let limitClause = ''

  if (options.groupBy) {
    let groupMapping = getFieldMapping(options.entityType, options.groupBy.field)
    let groupExpr: string | null = null

    // Handle JSONB path notation (e.g., shippingAddressSnapshot.region)
    if (!groupMapping && options.groupBy.field.includes('.')) {
      const [baseField, ...pathParts] = options.groupBy.field.split('.')
      const baseMapping = getFieldMapping(options.entityType, baseField)
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
    const dateMapping = getFieldMapping(options.entityType, options.dateRange.field)
    if (dateMapping) {
      whereClauses.push(`${dateMapping.dbColumn} >= ?`)
      params.push(options.dateRange.start)
      whereClauses.push(`${dateMapping.dbColumn} <= ?`)
      params.push(options.dateRange.end)
    }
  }

  if (options.filters) {
    for (const filter of options.filters) {
      const filterMapping = getFieldMapping(options.entityType, filter.field)
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
