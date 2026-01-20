/**
 * @jest-environment node
 */
import {
  isValidGranularity,
  isValidAggregate,
  isValidEntityType,
  getEntityTypeConfig,
  getFieldMapping,
  buildAggregateExpression,
  buildDateTruncExpression,
  buildJsonbFieldExpression,
  buildAggregationQuery,
  ENTITY_TYPE_CONFIG,
  FIELD_MAPPINGS,
} from '../aggregations'

describe('aggregations', () => {
  describe('isValidGranularity', () => {
    it('returns true for valid granularities', () => {
      expect(isValidGranularity('day')).toBe(true)
      expect(isValidGranularity('week')).toBe(true)
      expect(isValidGranularity('month')).toBe(true)
      expect(isValidGranularity('quarter')).toBe(true)
      expect(isValidGranularity('year')).toBe(true)
    })

    it('returns false for invalid granularities', () => {
      expect(isValidGranularity('invalid')).toBe(false)
      expect(isValidGranularity('')).toBe(false)
      expect(isValidGranularity(null)).toBe(false)
      expect(isValidGranularity(undefined)).toBe(false)
      expect(isValidGranularity(123)).toBe(false)
    })
  })

  describe('isValidAggregate', () => {
    it('returns true for valid aggregates', () => {
      expect(isValidAggregate('count')).toBe(true)
      expect(isValidAggregate('sum')).toBe(true)
      expect(isValidAggregate('avg')).toBe(true)
      expect(isValidAggregate('min')).toBe(true)
      expect(isValidAggregate('max')).toBe(true)
    })

    it('returns false for invalid aggregates', () => {
      expect(isValidAggregate('invalid')).toBe(false)
      expect(isValidAggregate('COUNT')).toBe(false) // case sensitive
      expect(isValidAggregate('')).toBe(false)
      expect(isValidAggregate(null)).toBe(false)
    })
  })

  describe('isValidEntityType', () => {
    it('returns true for valid entity types', () => {
      expect(isValidEntityType('sales:orders')).toBe(true)
      expect(isValidEntityType('sales:order_lines')).toBe(true)
      expect(isValidEntityType('customers:entities')).toBe(true)
      expect(isValidEntityType('customers:deals')).toBe(true)
      expect(isValidEntityType('catalog:products')).toBe(true)
    })

    it('returns false for invalid entity types', () => {
      expect(isValidEntityType('invalid')).toBe(false)
      expect(isValidEntityType('sales:invalid')).toBe(false)
      expect(isValidEntityType('')).toBe(false)
    })
  })

  describe('getEntityTypeConfig', () => {
    it('returns config for valid entity types', () => {
      const config = getEntityTypeConfig('sales:orders')
      expect(config).not.toBeNull()
      expect(config?.tableName).toBe('sales_orders')
      expect(config?.dateField).toBe('placed_at')
    })

    it('returns null for invalid entity types', () => {
      expect(getEntityTypeConfig('invalid')).toBeNull()
    })
  })

  describe('getFieldMapping', () => {
    it('returns mapping for valid fields', () => {
      const mapping = getFieldMapping('sales:orders', 'grandTotalGrossAmount')
      expect(mapping).not.toBeNull()
      expect(mapping?.dbColumn).toBe('grand_total_gross_amount')
      expect(mapping?.type).toBe('numeric')
    })

    it('returns null for invalid fields', () => {
      expect(getFieldMapping('sales:orders', 'invalidField')).toBeNull()
    })

    it('returns null for invalid entity types', () => {
      expect(getFieldMapping('invalid', 'grandTotalGrossAmount')).toBeNull()
    })
  })

  describe('buildAggregateExpression', () => {
    it('builds COUNT(*) for count with id column', () => {
      expect(buildAggregateExpression('count', 'id')).toBe('COUNT(*)')
    })

    it('builds COUNT(column) for count with other columns', () => {
      expect(buildAggregateExpression('count', 'status')).toBe('COUNT(status)')
    })

    it('builds SUM with COALESCE', () => {
      expect(buildAggregateExpression('sum', 'amount')).toBe('COALESCE(SUM(amount::numeric), 0)')
    })

    it('builds AVG with COALESCE', () => {
      expect(buildAggregateExpression('avg', 'amount')).toBe('COALESCE(AVG(amount::numeric), 0)')
    })

    it('builds MIN', () => {
      expect(buildAggregateExpression('min', 'amount')).toBe('MIN(amount::numeric)')
    })

    it('builds MAX', () => {
      expect(buildAggregateExpression('max', 'amount')).toBe('MAX(amount::numeric)')
    })
  })

  describe('buildDateTruncExpression', () => {
    it('builds DATE_TRUNC for valid granularity', () => {
      expect(buildDateTruncExpression('created_at', 'day')).toBe("DATE_TRUNC('day', created_at)")
      expect(buildDateTruncExpression('created_at', 'month')).toBe("DATE_TRUNC('month', created_at)")
    })

    it('throws for invalid granularity', () => {
      expect(() => buildDateTruncExpression('created_at', 'invalid' as any)).toThrow('Invalid granularity')
    })
  })

  describe('buildJsonbFieldExpression', () => {
    it('builds single-level JSONB access', () => {
      expect(buildJsonbFieldExpression('data', 'name')).toBe("data->>'name'")
    })

    it('builds nested JSONB access', () => {
      expect(buildJsonbFieldExpression('data', 'address.city')).toBe("data->'address'->>'city'")
    })

    it('builds deeply nested JSONB access', () => {
      expect(buildJsonbFieldExpression('data', 'a.b.c')).toBe("data->'a'->'b'->>'c'")
    })

    it('throws for invalid path parts', () => {
      expect(() => buildJsonbFieldExpression('data', 'invalid-path')).toThrow('Invalid JSONB path part')
      expect(() => buildJsonbFieldExpression('data', '123invalid')).toThrow('Invalid JSONB path part')
      expect(() => buildJsonbFieldExpression('data', 'valid.123invalid')).toThrow('Invalid JSONB path part')
    })

    it('allows valid identifier characters', () => {
      expect(buildJsonbFieldExpression('data', 'valid_name')).toBe("data->>'valid_name'")
      expect(buildJsonbFieldExpression('data', '_private')).toBe("data->>'_private'")
      expect(buildJsonbFieldExpression('data', 'CamelCase')).toBe("data->>'CamelCase'")
    })
  })

  describe('buildAggregationQuery', () => {
    const baseOptions = {
      entityType: 'sales:orders',
      metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' as const },
      scope: { tenantId: 'tenant-123' },
    }

    it('builds basic aggregation query', () => {
      const result = buildAggregationQuery(baseOptions)
      expect(result).not.toBeNull()
      expect(result?.sql).toContain('SELECT')
      expect(result?.sql).toContain('COALESCE(SUM(grand_total_gross_amount::numeric), 0)')
      expect(result?.sql).toContain('FROM "sales_orders"')
      expect(result?.sql).toContain('tenant_id = $1')
      expect(result?.params).toContain('tenant-123')
    })

    it('includes organization filter when provided', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        scope: { tenantId: 'tenant-123', organizationIds: ['org-1', 'org-2'] },
      })
      expect(result?.sql).toContain('organization_id = ANY($2::uuid[])')
      expect(result?.params).toContainEqual(['org-1', 'org-2'])
    })

    it('includes date range filter', () => {
      const start = new Date('2024-01-01')
      const end = new Date('2024-01-31')
      const result = buildAggregationQuery({
        ...baseOptions,
        dateRange: { field: 'placedAt', start, end },
      })
      expect(result?.sql).toContain('placed_at >= $')
      expect(result?.sql).toContain('placed_at <= $')
      expect(result?.params).toContain(start)
      expect(result?.params).toContain(end)
    })

    it('includes groupBy clause', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        groupBy: { field: 'status' },
      })
      expect(result?.sql).toContain('GROUP BY status')
      expect(result?.sql).toContain('status AS group_key')
    })

    it('includes groupBy with granularity for timestamp fields', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        groupBy: { field: 'placedAt', granularity: 'month' },
      })
      expect(result?.sql).toContain("DATE_TRUNC('month', placed_at)")
      expect(result?.sql).toContain('GROUP BY')
    })

    it('includes LIMIT when groupBy has limit', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        groupBy: { field: 'status', limit: 10 },
      })
      expect(result?.sql).toContain('LIMIT 10')
    })

    it('caps LIMIT at 100', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        groupBy: { field: 'status', limit: 200 },
      })
      expect(result?.sql).toContain('LIMIT 100')
    })

    it('includes deleted_at IS NULL filter', () => {
      const result = buildAggregationQuery(baseOptions)
      expect(result?.sql).toContain('deleted_at IS NULL')
    })

    it('handles various filter operators', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        filters: [
          { field: 'status', operator: 'eq', value: 'completed' },
          { field: 'grandTotalGrossAmount', operator: 'gte', value: 100 },
        ],
      })
      expect(result?.sql).toContain('status = $')
      expect(result?.sql).toContain('grand_total_gross_amount >= $')
    })

    it('handles is_null and is_not_null operators without value', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        filters: [
          { field: 'customerEntityId', operator: 'is_null' },
          { field: 'channelId', operator: 'is_not_null' },
        ],
      })
      expect(result?.sql).toContain('customer_entity_id IS NULL')
      expect(result?.sql).toContain('channel_id IS NOT NULL')
    })

    it('returns null for invalid entity type', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        entityType: 'invalid',
      })
      expect(result).toBeNull()
    })

    it('returns null for invalid metric field', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        metric: { field: 'invalidField', aggregate: 'sum' },
      })
      expect(result).toBeNull()
    })
  })

  describe('ENTITY_TYPE_CONFIG', () => {
    it('has all expected entity types', () => {
      expect(Object.keys(ENTITY_TYPE_CONFIG)).toEqual([
        'sales:orders',
        'sales:order_lines',
        'customers:entities',
        'customers:deals',
        'catalog:products',
      ])
    })

    it('each config has required fields', () => {
      Object.values(ENTITY_TYPE_CONFIG).forEach((config) => {
        expect(config.tableName).toBeDefined()
        expect(config.dateField).toBeDefined()
        expect(config.defaultScopeFields).toBeDefined()
        expect(Array.isArray(config.defaultScopeFields)).toBe(true)
      })
    })
  })

  describe('FIELD_MAPPINGS', () => {
    it('has mappings for all entity types', () => {
      Object.keys(ENTITY_TYPE_CONFIG).forEach((entityType) => {
        expect(FIELD_MAPPINGS[entityType]).toBeDefined()
      })
    })

    it('sales:orders has expected fields', () => {
      const fields = Object.keys(FIELD_MAPPINGS['sales:orders'])
      expect(fields).toContain('id')
      expect(fields).toContain('grandTotalGrossAmount')
      expect(fields).toContain('status')
      expect(fields).toContain('placedAt')
    })
  })
})
