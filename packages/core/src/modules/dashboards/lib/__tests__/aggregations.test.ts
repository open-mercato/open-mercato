/**
 * @jest-environment node
 */
import {
  buildAggregateExpression,
  buildDateTruncExpression,
  buildJsonbFieldExpression,
  buildAggregationQuery,
  buildGroupSourceRowsQuery,
  resolveGroupExpression,
  isValidGranularity,
  isValidAggregate,
} from '../aggregations'
import { PostgreSqlPlatform } from '@mikro-orm/postgresql'
import { createAnalyticsRegistry } from '../../services/analyticsRegistry'
import { analyticsConfig as salesAnalyticsConfig } from '../../../sales/analytics'
import { analyticsConfig as customersAnalyticsConfig } from '../../../customers/analytics'
import { analyticsConfig as catalogAnalyticsConfig } from '../../../catalog/analytics'

const testRegistry = createAnalyticsRegistry([salesAnalyticsConfig, customersAnalyticsConfig, catalogAnalyticsConfig])

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

  describe('isValidEntityType (via registry)', () => {
    it('returns true for valid entity types', () => {
      expect(testRegistry.isValidEntityType('sales:orders')).toBe(true)
      expect(testRegistry.isValidEntityType('sales:order_lines')).toBe(true)
      expect(testRegistry.isValidEntityType('customers:entities')).toBe(true)
      expect(testRegistry.isValidEntityType('customers:deals')).toBe(true)
      expect(testRegistry.isValidEntityType('catalog:products')).toBe(true)
    })

    it('returns false for invalid entity types', () => {
      expect(testRegistry.isValidEntityType('invalid')).toBe(false)
      expect(testRegistry.isValidEntityType('sales:invalid')).toBe(false)
      expect(testRegistry.isValidEntityType('')).toBe(false)
    })
  })

  describe('getEntityTypeConfig (via registry)', () => {
    it('returns config for valid entity types', () => {
      const config = testRegistry.getEntityTypeConfig('sales:orders')
      expect(config).not.toBeNull()
      expect(config?.tableName).toBe('sales_orders')
      expect(config?.dateField).toBe('placed_at')
    })

    it('returns null for invalid entity types', () => {
      expect(testRegistry.getEntityTypeConfig('invalid')).toBeNull()
    })
  })

  describe('getFieldMapping (via registry)', () => {
    it('returns mapping for valid fields', () => {
      const mapping = testRegistry.getFieldMapping('sales:orders', 'grandTotalGrossAmount')
      expect(mapping).not.toBeNull()
      expect(mapping?.dbColumn).toBe('grand_total_gross_amount')
      expect(mapping?.type).toBe('numeric')
    })

    it('returns null for invalid fields', () => {
      expect(testRegistry.getFieldMapping('sales:orders', 'invalidField')).toBeNull()
    })

    it('returns null for invalid entity types', () => {
      expect(testRegistry.getFieldMapping('invalid', 'grandTotalGrossAmount')).toBeNull()
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
      registry: testRegistry,
    }

    it('builds basic aggregation query', () => {
      const result = buildAggregationQuery(baseOptions)
      expect(result).not.toBeNull()
      expect(result?.sql).toContain('SELECT')
      expect(result?.sql).toContain('COALESCE(SUM(grand_total_gross_amount::numeric), 0)')
      expect(result?.sql).toContain('FROM "sales_orders"')
      expect(result?.sql).toContain('tenant_id = ?')
      expect(result?.params).toContain('tenant-123')
    })

    it('includes organization filter when provided', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        scope: { tenantId: 'tenant-123', organizationIds: ['org-1', 'org-2'] },
      })
      expect(result?.sql).toContain('organization_id = ANY(?::uuid[])')
      expect(result?.params).toContain('{org-1,org-2}')
    })

    it('includes date range filter', () => {
      const start = new Date('2024-01-01')
      const end = new Date('2024-01-31')
      const result = buildAggregationQuery({
        ...baseOptions,
        dateRange: { field: 'placedAt', start, end },
      })
      expect(result?.sql).toContain('placed_at >= ?')
      expect(result?.sql).toContain('placed_at <= ?')
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
      expect(result?.sql).toContain('status = ?')
      expect(result?.sql).toContain('grand_total_gross_amount >= ?')
    })

    it('expands an in filter into one placeholder and one parameter per member', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        filters: [{ field: 'status', operator: 'in', value: ['completed', 'shipped'] }],
      })
      expect(result?.sql).toContain('status IN (?, ?)')
      expect(result?.params).toEqual(['tenant-123', 'completed', 'shipped'])
    })

    it('expands a not_in filter into one placeholder and one parameter per member', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        filters: [{ field: 'status', operator: 'not_in', value: ['cancelled', 'refunded'] }],
      })
      expect(result?.sql).toContain('status NOT IN (?, ?)')
      expect(result?.params).toEqual(['tenant-123', 'cancelled', 'refunded'])
    })

    it('treats a single-member set filter like any other set filter', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        filters: [{ field: 'status', operator: 'in', value: ['completed'] }],
      })
      expect(result?.sql).toContain('status IN (?)')
      expect(result?.params).toEqual(['tenant-123', 'completed'])
    })

    it('accepts a scalar value for a set filter', () => {
      const result = buildAggregationQuery({
        ...baseOptions,
        filters: [{ field: 'status', operator: 'not_in', value: 'cancelled' }],
      })
      expect(result?.sql).toContain('status NOT IN (?)')
      expect(result?.params).toEqual(['tenant-123', 'cancelled'])
    })

    it('renders an empty set filter as a constant instead of empty parentheses', () => {
      const emptyIn = buildAggregationQuery({
        ...baseOptions,
        filters: [{ field: 'status', operator: 'in', value: [] }],
      })
      expect(emptyIn?.sql).toContain('AND FALSE')
      expect(emptyIn?.sql).not.toContain('IN ()')
      expect(emptyIn?.params).toEqual(['tenant-123'])

      const emptyNotIn = buildAggregationQuery({
        ...baseOptions,
        filters: [{ field: 'status', operator: 'not_in', value: undefined }],
      })
      expect(emptyNotIn?.sql).toContain('AND TRUE')
      expect(emptyNotIn?.params).toEqual(['tenant-123'])
    })

    it('applies set filters to the encrypted group-source row query as well', () => {
      const result = buildGroupSourceRowsQuery({
        ...baseOptions,
        groupColumn: 'shipping_address_snapshot',
        rowLimit: 10,
        filters: [{ field: 'status', operator: 'in', value: ['completed', 'shipped'] }],
      })
      expect(result?.sql).toContain('status IN (?, ?)')
      expect(result?.params).toEqual(['tenant-123', 'completed', 'shipped'])
    })

    /**
     * `WidgetDataService` runs these queries through `em.getConnection().execute(sql, params)`.
     * MikroORM does not hand the parameters to the driver: `AbstractSqlConnection.execute` calls
     * `platform.formatQuery`, which interpolates every value into the SQL string. This suite
     * cannot open a PostgreSQL connection, so it asserts on the output of that same interpolation
     * — the exact text the server receives. End-to-end execution against a live PostgreSQL is
     * covered by `__integration__/TC-DASH-010-set-filter-operators.spec.ts`.
     */
    describe('rendered SQL (PostgreSqlPlatform.formatQuery)', () => {
      const platform = new PostgreSqlPlatform()

      it('renders set filters as a valid PostgreSQL IN list', () => {
        const result = buildAggregationQuery({
          ...baseOptions,
          filters: [
            { field: 'status', operator: 'in', value: ['completed', "o'brien"] },
            { field: 'paymentStatus', operator: 'not_in', value: ['refunded'] },
          ],
        })
        const rendered = platform.formatQuery(result!.sql, result!.params)
        expect(rendered).toContain("status IN ('completed', 'o''brien')")
        expect(rendered).toContain("payment_status NOT IN ('refunded')")
      })

      it('rejects the array-as-single-parameter form this fix replaced', () => {
        // Kept as an executable record of the defect in #4669: PostgreSQL answers
        // `syntax error at or near ","` for a multi-member list and `malformed array literal`
        // for a single-member one, so `in`/`not_in` failed for every possible value.
        expect(platform.formatQuery('status = ANY(?)', [['completed', 'shipped']])).toBe(
          "status = ANY('completed', 'shipped')",
        )
        expect(platform.formatQuery('status != ALL(?)', [['cancelled']])).toBe("status != ALL('cancelled')")
      })
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

  describe('resolveGroupExpression', () => {
    it('resolves a plain column', () => {
      const resolved = resolveGroupExpression(testRegistry, 'sales:orders', { field: 'status' })
      expect(resolved).toEqual({ expression: 'status', dbColumn: 'status', jsonPath: null })
    })

    it('resolves a timestamp column with granularity', () => {
      const resolved = resolveGroupExpression(testRegistry, 'sales:orders', {
        field: 'placedAt',
        granularity: 'month',
      })
      expect(resolved).toEqual({
        expression: "DATE_TRUNC('month', placed_at)",
        dbColumn: 'placed_at',
        jsonPath: null,
      })
    })

    it('exposes the underlying column and path for JSONB notation', () => {
      const resolved = resolveGroupExpression(testRegistry, 'sales:orders', {
        field: 'shippingAddressSnapshot.region',
      })
      expect(resolved).toEqual({
        expression: "shipping_address_snapshot->>'region'",
        dbColumn: 'shipping_address_snapshot',
        jsonPath: 'region',
      })
    })

    it('returns null for unknown fields', () => {
      expect(resolveGroupExpression(testRegistry, 'sales:orders', { field: 'nope' })).toBeNull()
      expect(resolveGroupExpression(testRegistry, 'sales:orders', { field: 'status.nested' })).toBeNull()
    })
  })

  describe('buildGroupSourceRowsQuery', () => {
    const baseOptions = {
      entityType: 'sales:orders',
      metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' as const },
      scope: { tenantId: 'tenant-123' },
      registry: testRegistry,
      groupColumn: 'shipping_address_snapshot',
      rowLimit: 100,
    }

    it('selects the raw group source next to the metric column', () => {
      const result = buildGroupSourceRowsQuery(baseOptions)
      expect(result?.sql).toContain('SELECT shipping_address_snapshot AS group_source, grand_total_gross_amount AS metric_value')
      expect(result?.sql).toContain('FROM "sales_orders"')
      expect(result?.sql).not.toContain('GROUP BY')
    })

    it('keeps tenant, organization, soft-delete and date scoping', () => {
      const start = new Date('2024-01-01')
      const end = new Date('2024-01-31')
      const result = buildGroupSourceRowsQuery({
        ...baseOptions,
        scope: { tenantId: 'tenant-123', organizationIds: ['org-1'] },
        dateRange: { field: 'placedAt', start, end },
      })
      expect(result?.sql).toContain('tenant_id = ?')
      expect(result?.sql).toContain('organization_id = ANY(?::uuid[])')
      expect(result?.sql).toContain('deleted_at IS NULL')
      expect(result?.sql).toContain('placed_at >= ?')
      expect(result?.params).toEqual(['tenant-123', '{org-1}', start, end])
    })

    it('fetches one row beyond the cap so overflow is detectable', () => {
      expect(buildGroupSourceRowsQuery({ ...baseOptions, rowLimit: 10 })?.sql).toContain('LIMIT 11')
    })

    it('rejects an unsafe group column', () => {
      expect(() => buildGroupSourceRowsQuery({ ...baseOptions, groupColumn: 'a"; drop table x --' })).toThrow(
        'Invalid group column',
      )
    })

    it('returns null for an invalid entity type or metric field', () => {
      expect(buildGroupSourceRowsQuery({ ...baseOptions, entityType: 'invalid' })).toBeNull()
      expect(
        buildGroupSourceRowsQuery({ ...baseOptions, metric: { field: 'nope', aggregate: 'sum' } }),
      ).toBeNull()
    })
  })

  describe('entity type configs (via registry)', () => {
    it('has all expected entity types', () => {
      const entityIds = testRegistry.getAllEntityConfigs().map((c) => c.entityId)
      expect(entityIds).toEqual(
        expect.arrayContaining([
          'sales:orders',
          'sales:order_lines',
          'sales:quotes',
          'customers:entities',
          'customers:deals',
          'catalog:products',
        ]),
      )
      expect(entityIds).toHaveLength(6)
    })

    it('each config has required fields', () => {
      testRegistry.getAllEntityConfigs().forEach((entityConfig) => {
        expect(entityConfig.entityConfig.tableName).toBeDefined()
        expect(entityConfig.entityConfig.dateField).toBeDefined()
        expect(entityConfig.entityConfig.defaultScopeFields).toBeDefined()
        expect(Array.isArray(entityConfig.entityConfig.defaultScopeFields)).toBe(true)
      })
    })
  })

  describe('field mappings (via registry)', () => {
    it('has mappings for all entity types', () => {
      testRegistry.getAllEntityConfigs().forEach((entityConfig) => {
        const mappings = testRegistry.getAllFieldMappings(entityConfig.entityId)
        expect(mappings).toBeDefined()
      })
    })

    it('sales:orders has expected fields', () => {
      const mappings = testRegistry.getAllFieldMappings('sales:orders')
      expect(mappings).not.toBeNull()
      const fields = Object.keys(mappings!)
      expect(fields).toContain('id')
      expect(fields).toContain('grandTotalGrossAmount')
      expect(fields).toContain('status')
      expect(fields).toContain('placedAt')
    })
  })
})
