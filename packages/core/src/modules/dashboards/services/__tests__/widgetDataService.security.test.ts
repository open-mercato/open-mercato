/**
 * @jest-environment node
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'
import { WidgetDataService, WidgetDataValidationError, type WidgetDataRequest } from '../widgetDataService'
import { createAnalyticsRegistry, type AnalyticsRegistry } from '../analyticsRegistry'
import { runWidgetDataBatch } from '../../lib/widgetDataBatch'
import type { BaseCurrencyResolver } from '../../lib/optionalBaseCurrency'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'

function buildValidModuleConfig(overrides?: Partial<AnalyticsModuleConfig['entities'][number]>): AnalyticsModuleConfig {
  return {
    entities: [
      {
        entityId: 'sales:orders',
        requiredFeatures: ['sales.orders.view'],
        entityConfig: {
          tableName: 'sales_orders',
          dateField: 'placed_at',
          defaultScopeFields: ['tenant_id', 'organization_id'],
          currencyField: 'currencyCode',
        },
        fieldMappings: {
          id: { dbColumn: 'id', type: 'uuid' },
          grandTotalGrossAmount: { dbColumn: 'grand_total_gross_amount', type: 'numeric' },
          status: { dbColumn: 'status', type: 'text' },
          placedAt: { dbColumn: 'placed_at', type: 'timestamp' },
          currencyCode: { dbColumn: 'currency_code', type: 'text' },
          customerEntityId: { dbColumn: 'customer_entity_id', type: 'uuid' },
          shippingAddressSnapshot: { dbColumn: 'shipping_address_snapshot', type: 'jsonb' },
        },
        labelResolvers: {
          customerEntityId: {
            table: 'customer_entities',
            idColumn: 'id',
            labelColumn: 'display_name',
          },
        },
        ...overrides,
      },
    ],
  }
}

function createServiceWithSpy(
  registry: AnalyticsRegistry,
  executeImpl?: (sql: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>,
  baseCurrencyResolver?: BaseCurrencyResolver,
) {
  const execute = jest.fn(
    executeImpl ?? (async (sql: string) => (sql.includes('SELECT DISTINCT') ? [{ code: 'EUR' }] : [{ value: 123 }])),
  )
  const em = {
    getConnection: () => ({ execute }),
  } as unknown as EntityManager
  const service = new WidgetDataService({
    em,
    scope: { tenantId: TENANT_ID, organizationIds: [ORG_ID] },
    registry,
    baseCurrencyResolver,
  })
  return { service, execute }
}

const baseRequest: WidgetDataRequest = {
  entityType: 'sales:orders',
  metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
}

describe('WidgetDataService & batch identifier/prototype hardening (#10332)', () => {
  it('executes valid schema-qualified and un-schemed queries across aggregate, filter, date, group, JSONB, currency, and label paths', async () => {
    const schemaConfig = buildValidModuleConfig()
    schemaConfig.entities[0].entityConfig.schema = 'analytics_v1'
    const registry = createAnalyticsRegistry([schemaConfig])
    const baseCurrencyResolver: BaseCurrencyResolver = {
      resolveBaseCurrency: jest.fn(async () => ({ status: 'resolved', code: 'EUR' })),
    }

    const customerUuid = '33333333-3333-4333-8333-333333333333'
    const { service, execute } = createServiceWithSpy(
      registry,
      async (sql) => {
        if (sql.includes('SELECT DISTINCT')) return [{ code: 'EUR' }]
        if (sql.includes('FROM "customer_entities"')) {
          return [{ id: customerUuid, label: 'Acme Corp', tenant_id: TENANT_ID, organization_id: ORG_ID }]
        }
        return [{ group_key: customerUuid, value: 450 }]
      },
      baseCurrencyResolver,
    )

    const response = await service.fetchWidgetData({
      entityType: 'sales:orders',
      metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
      groupBy: { field: 'customerEntityId', resolveLabels: true, limit: 5 },
      dateRange: { field: 'placedAt', preset: 'this_month' },
      filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
    })

    expect(response.value).toBe(450)
    expect(response.metadata.currency).toBe('EUR')
    expect(response.data).toEqual([{ groupKey: customerUuid, groupLabel: 'Acme Corp', value: 450 }])
    const sqlStatements = execute.mock.calls.map(([sql]) => sql as string)
    expect(sqlStatements.some((sql) => sql.includes('FROM "analytics_v1"."sales_orders"'))).toBe(true)
    expect(sqlStatements.some((sql) => sql.includes('SELECT DISTINCT UPPER(NULLIF(BTRIM(currency_code)'))).toBe(true)

    // Verify JSONB groupBy path works cleanly too.
    const jsonbResult = await service.fetchWidgetData({
      entityType: 'sales:orders',
      metric: { field: 'grandTotalGrossAmount', aggregate: 'count' },
      groupBy: { field: 'shippingAddressSnapshot.region', limit: 3 },
    })
    expect(jsonbResult.data).toHaveLength(1)
    expect(execute.mock.calls.some(([sql]) => (sql as string).includes("shipping_address_snapshot->>'region'"))).toBe(true)
  })

  it.each([
    [
      'unsafe tableName',
      () => {
        const cfg = buildValidModuleConfig()
        cfg.entities[0].entityConfig.tableName = 'sales_orders; DROP TABLE users--'
        return createAnalyticsRegistry([cfg])
      },
      baseRequest,
    ],
    [
      'unsafe schema',
      () => {
        const cfg = buildValidModuleConfig()
        cfg.entities[0].entityConfig.schema = 'public evil'
        return createAnalyticsRegistry([cfg])
      },
      baseRequest,
    ],
    [
      'unsafe metric dbColumn',
      () => {
        const cfg = buildValidModuleConfig()
        cfg.entities[0].fieldMappings.grandTotalGrossAmount = { dbColumn: '1) FROM users--', type: 'numeric' }
        return createAnalyticsRegistry([cfg])
      },
      baseRequest,
    ],
    [
      'unsafe filter dbColumn',
      () => {
        const cfg = buildValidModuleConfig()
        cfg.entities[0].fieldMappings.status = { dbColumn: 'status OR 1=1 --', type: 'text' }
        return createAnalyticsRegistry([cfg])
      },
      { ...baseRequest, filters: [{ field: 'status', operator: 'eq' as const, value: 'open' }] },
    ],
    [
      'unsafe dateRange dbColumn',
      () => {
        const cfg = buildValidModuleConfig()
        cfg.entities[0].fieldMappings.placedAt = { dbColumn: 'placed_at; SELECT 1', type: 'timestamp' }
        return createAnalyticsRegistry([cfg])
      },
      { ...baseRequest, dateRange: { field: 'placedAt', preset: 'this_month' as const } },
    ],
    [
      'unsafe groupBy dbColumn',
      () => {
        const cfg = buildValidModuleConfig()
        cfg.entities[0].fieldMappings.status = { dbColumn: 'status; DROP TABLE x', type: 'text' }
        return createAnalyticsRegistry([cfg])
      },
      { ...baseRequest, groupBy: { field: 'status' } },
    ],
    [
      'unsafe JSONB base dbColumn',
      () => {
        const cfg = buildValidModuleConfig()
        cfg.entities[0].fieldMappings.shippingAddressSnapshot = { dbColumn: 'snap shot', type: 'jsonb' }
        return createAnalyticsRegistry([cfg])
      },
      { ...baseRequest, groupBy: { field: 'shippingAddressSnapshot.region' } },
    ],
    [
      'unsafe JSONB path part',
      () => createAnalyticsRegistry([buildValidModuleConfig()]),
      { ...baseRequest, groupBy: { field: "shippingAddressSnapshot.region' OR '1'='1" } },
    ],
    [
      'unsafe currency dbColumn',
      () => {
        const cfg = buildValidModuleConfig()
        cfg.entities[0].fieldMappings.currencyCode = { dbColumn: 'currency_code); DROP TABLE x--', type: 'text' }
        return createAnalyticsRegistry([cfg])
      },
      baseRequest,
    ],
    [
      'unsafe labelResolver table',
      () => {
        const cfg = buildValidModuleConfig()
        cfg.entities[0].labelResolvers!.customerEntityId.table = 'customer_entities" ; DROP TABLE x--'
        return createAnalyticsRegistry([cfg])
      },
      { ...baseRequest, groupBy: { field: 'customerEntityId', resolveLabels: true } },
    ],
  ])('rejects %s in single and batch entry points before any database connection call', async (_label, buildRegistry, request) => {
    const registry = buildRegistry()
    const baseCurrencyResolver: BaseCurrencyResolver = {
      resolveBaseCurrency: jest.fn(async () => ({ status: 'resolved', code: 'EUR' })),
    }
    const { service, execute } = createServiceWithSpy(registry, undefined, baseCurrencyResolver)

    await expect(service.fetchWidgetData(request)).rejects.toThrow()
    expect(execute).not.toHaveBeenCalled()

    const batchResults = await runWidgetDataBatch(
      [{ id: 'unsafe-widget', request }],
      {
        getRequiredFeatures: (entityType) => registry.getRequiredFeatures(entityType),
        checkFeatures: async () => true,
        fetchOne: (req) => service.fetchWidgetData(req),
        describeError: (err) => (err instanceof Error ? err.message : 'failed'),
      },
    )

    expect(batchResults).toHaveLength(1)
    expect(batchResults[0].ok).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects inherited field mappings and ignores inherited schema/currencyField in single and batch execution', async () => {
    const entityConfig = Object.create({
      schema: 'evil schema',
      currencyField: 'pollutedCurrency',
    })
    entityConfig.tableName = 'sales_orders'
    entityConfig.dateField = 'placed_at'
    entityConfig.defaultScopeFields = ['tenant_id', 'organization_id']

    const fieldMappings = Object.create({
      pollutedMetric: { dbColumn: '1; DROP TABLE sales_orders--', type: 'numeric' },
      pollutedCurrency: { dbColumn: 'currency_code; --', type: 'text' },
    })
    fieldMappings.grandTotalGrossAmount = { dbColumn: 'grand_total_gross_amount', type: 'numeric' }
    fieldMappings.status = { dbColumn: 'status', type: 'text' }

    const registry = createAnalyticsRegistry([
      {
        entities: [
          {
            entityId: 'sales:orders',
            requiredFeatures: ['sales.orders.view'],
            entityConfig,
            fieldMappings,
          },
        ],
      },
    ])

    const { service, execute } = createServiceWithSpy(registry)

    // Inherited metric field is rejected before any connection call.
    await expect(
      service.fetchWidgetData({
        entityType: 'sales:orders',
        metric: { field: 'pollutedMetric', aggregate: 'sum' },
      }),
    ).rejects.toBeInstanceOf(WidgetDataValidationError)
    await expect(
      service.fetchWidgetData({
        entityType: 'sales:orders',
        metric: { field: 'toString', aggregate: 'sum' },
      }),
    ).rejects.toBeInstanceOf(WidgetDataValidationError)
    expect(execute).not.toHaveBeenCalled()

    // Valid request ignores inherited schema and inherited currencyField.
    const batchResults = await runWidgetDataBatch(
      [
        {
          id: 'inherited-metric',
          request: {
            entityType: 'sales:orders',
            metric: { field: 'pollutedMetric', aggregate: 'sum' },
          },
        },
        {
          id: 'valid-metric',
          request: {
            entityType: 'sales:orders',
            metric: { field: 'grandTotalGrossAmount', aggregate: 'sum' },
          },
        },
      ],
      {
        getRequiredFeatures: (entityType) => registry.getRequiredFeatures(entityType),
        checkFeatures: async () => true,
        fetchOne: (req) => service.fetchWidgetData(req),
        describeError: (err) => (err instanceof WidgetDataValidationError ? err.message : 'failed'),
      },
    )

    expect(batchResults[0]).toEqual({
      id: 'inherited-metric',
      ok: false,
      error: 'Invalid metric field: pollutedMetric for entity type: sales:orders',
    })
    expect(batchResults[1].ok).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toContain('FROM "sales_orders"')
    expect(execute.mock.calls[0][0]).not.toContain('evil schema')
  })

  it('rejects unsafe identifiers even when a custom AnalyticsRegistry stub bypasses DefaultAnalyticsRegistry', async () => {
    const stubRegistry: AnalyticsRegistry = {
      getAllEntityConfigs: () => [],
      getEntityConfig: () => null,
      isValidEntityType: () => true,
      getEntityTypeConfig: () => ({
        tableName: 'sales_orders',
        schema: 'bad schema',
        dateField: 'placed_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      }),
      getFieldMapping: () => ({ dbColumn: 'grand_total_gross_amount', type: 'numeric' }),
      getRequiredFeatures: () => null,
      getLabelResolverConfig: () => null,
      getAllFieldMappings: () => null,
    }

    const { service, execute } = createServiceWithSpy(stubRegistry)
    await expect(service.fetchWidgetData(baseRequest)).rejects.toThrow(/Invalid schema name/)
    expect(execute).not.toHaveBeenCalled()
  })
})
