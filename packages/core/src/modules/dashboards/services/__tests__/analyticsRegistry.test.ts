/**
 * @jest-environment node
 */
import vm from 'node:vm'
import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'
import { createAnalyticsRegistry } from '../analyticsRegistry'
import { readOwnProperty, hasOwnProperty, isSafeIdentifier, assertSafeIdentifier } from '../../lib/identifiers'

function buildBaseModuleConfig(): AnalyticsModuleConfig {
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
          amount: { dbColumn: 'grand_total_gross_amount', type: 'numeric' },
          currencyCode: { dbColumn: 'currency_code', type: 'text' },
          status: { dbColumn: 'status', type: 'text' },
        },
        labelResolvers: {
          customerEntityId: {
            table: 'customer_entities',
            idColumn: 'id',
            labelColumn: 'display_name',
          },
        },
      },
    ],
  }
}

describe('DefaultAnalyticsRegistry security hardening (#10332)', () => {
  it('ignores inherited Object.prototype and custom-prototype fieldMappings, labelResolvers, schema, and currencyField', () => {
    const inheritedFieldMappings = Object.create({
      pollutedField: { dbColumn: 'id; DROP TABLE sales_orders--', type: 'numeric' },
    }) as Record<string, { dbColumn: string; type: 'numeric' | 'text' | 'uuid' | 'timestamp' | 'jsonb' }>
    inheritedFieldMappings.amount = { dbColumn: 'grand_total_gross_amount', type: 'numeric' }

    const inheritedEntityConfig = Object.create({
      schema: 'evil schema',
      currencyField: 'pollutedCurrency',
    })
    inheritedEntityConfig.tableName = 'sales_orders'
    inheritedEntityConfig.dateField = 'placed_at'
    inheritedEntityConfig.defaultScopeFields = ['tenant_id', 'organization_id']

    const inheritedLabelResolvers = Object.create({
      status: { table: 'evil_table; --', idColumn: 'id', labelColumn: 'name' },
    })

    const registry = createAnalyticsRegistry([
      {
        entities: [
          {
            entityId: 'sales:orders',
            requiredFeatures: ['sales.orders.view'],
            entityConfig: inheritedEntityConfig,
            fieldMappings: inheritedFieldMappings,
            labelResolvers: inheritedLabelResolvers,
          },
        ],
      },
    ])

    expect(registry.getFieldMapping('sales:orders', 'amount')).toEqual({
      dbColumn: 'grand_total_gross_amount',
      type: 'numeric',
    })
    expect(registry.getFieldMapping('sales:orders', 'pollutedField')).toBeNull()
    expect(registry.getFieldMapping('sales:orders', 'toString')).toBeNull()
    expect(registry.getFieldMapping('sales:orders', 'constructor')).toBeNull()
    expect(registry.getFieldMapping('sales:orders', '__proto__')).toBeNull()

    const entityTypeConfig = registry.getEntityTypeConfig('sales:orders')
    expect(entityTypeConfig).not.toBeNull()
    expect(Object.getPrototypeOf(entityTypeConfig)).toBeNull()
    expect(entityTypeConfig?.tableName).toBe('sales_orders')
    expect(entityTypeConfig?.schema).toBeUndefined()
    expect(entityTypeConfig?.currencyField).toBeUndefined()

    expect(registry.getLabelResolverConfig('sales:orders', 'status')).toBeNull()
    expect(registry.getLabelResolverConfig('sales:orders', 'toString')).toBeNull()

    const allMappings = registry.getAllFieldMappings('sales:orders')
    expect(allMappings).not.toBeNull()
    expect(Object.getPrototypeOf(allMappings)).toBeNull()
    expect(Object.keys(allMappings!)).toEqual(['amount'])
  })

  it('preserves valid schema-qualified entity configurations and own label resolvers', () => {
    const moduleConfig = buildBaseModuleConfig()
    moduleConfig.entities[0].entityConfig.schema = 'analytics_reporting'
    const registry = createAnalyticsRegistry([moduleConfig])

    const entityTypeConfig = registry.getEntityTypeConfig('sales:orders')
    expect(entityTypeConfig?.schema).toBe('analytics_reporting')
    expect(entityTypeConfig?.tableName).toBe('sales_orders')
    expect(registry.getLabelResolverConfig('sales:orders', 'customerEntityId')).toEqual({
      table: 'customer_entities',
      idColumn: 'id',
      labelColumn: 'display_name',
    })
  })

  it('rejects invalid tableName, schema, dbColumn, and labelResolver identifiers', () => {
    const badTable = buildBaseModuleConfig()
    badTable.entities[0].entityConfig.tableName = 'sales_orders; DROP TABLE users'
    expect(() => createAnalyticsRegistry([badTable]).getEntityTypeConfig('sales:orders')).toThrow(
      /Invalid table name/,
    )

    const badSchema = buildBaseModuleConfig()
    badSchema.entities[0].entityConfig.schema = 'public evil'
    expect(() => createAnalyticsRegistry([badSchema]).getEntityTypeConfig('sales:orders')).toThrow(
      /Invalid schema name/,
    )

    const badColumn = buildBaseModuleConfig()
    badColumn.entities[0].fieldMappings.amount = { dbColumn: 'amount::numeric) FROM users--', type: 'numeric' }
    expect(() => createAnalyticsRegistry([badColumn]).getFieldMapping('sales:orders', 'amount')).toThrow(
      /Invalid column name/,
    )

    const badLabelTable = buildBaseModuleConfig()
    badLabelTable.entities[0].labelResolvers!.customerEntityId.table = 'customer_entities" UNION SELECT'
    expect(() =>
      createAnalyticsRegistry([badLabelTable]).getLabelResolverConfig('sales:orders', 'customerEntityId'),
    ).toThrow(/Invalid table name/)

    const badLabelId = buildBaseModuleConfig()
    badLabelId.entities[0].labelResolvers!.customerEntityId.idColumn = 'id; --'
    expect(() =>
      createAnalyticsRegistry([badLabelId]).getLabelResolverConfig('sales:orders', 'customerEntityId'),
    ).toThrow(/Invalid id column/)

    const badLabelColumn = buildBaseModuleConfig()
    badLabelColumn.entities[0].labelResolvers!.customerEntityId.labelColumn = 'display name'
    expect(() =>
      createAnalyticsRegistry([badLabelColumn]).getLabelResolverConfig('sales:orders', 'customerEntityId'),
    ).toThrow(/Invalid label column/)
  })

  it('ignores polluted Object.prototype properties inside an isolated VM realm without contaminating global test state', () => {
    const realm = vm.createContext({
      readOwnSource: readOwnProperty.toString(),
      hasOwnSource: hasOwnProperty.toString(),
      isSafeSource: isSafeIdentifier.toString(),
      assertSafeSource: assertSafeIdentifier.toString(),
    })

    const outcome = vm.runInContext(
      `
      const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/
      const hasOwnProperty = eval('(' + hasOwnSource + ')')
      const readOwnProperty = eval('(' + readOwnSource + ')')
      const isSafeIdentifier = eval('(' + isSafeSource + ')')
      const assertSafeIdentifier = eval('(' + assertSafeSource + ')')

      // Pollute ONLY this isolated VM realm's Object.prototype.
      Object.prototype.schema = 'polluted schema'
      Object.prototype.currencyField = 'pollutedCurrency'
      Object.prototype.pollutedField = { dbColumn: '1; DROP TABLE sales_orders--', type: 'numeric' }
      Object.prototype.labelResolvers = { status: { table: 'evil_table', idColumn: 'id', labelColumn: 'name' } }

      const entityConfig = { tableName: 'sales_orders', dateField: 'placed_at', defaultScopeFields: ['tenant_id'] }
      const fieldMappings = { id: { dbColumn: 'id', type: 'uuid' } }
      const entity = { entityId: 'sales:orders', entityConfig, fieldMappings }

      const resolvedSchema = readOwnProperty(entityConfig, 'schema')
      const resolvedCurrencyField = readOwnProperty(entityConfig, 'currencyField')
      const resolvedLabelResolvers = readOwnProperty(entity, 'labelResolvers')
      const hasPollutedField = hasOwnProperty(fieldMappings, 'pollutedField')
      const hasIdField = hasOwnProperty(fieldMappings, 'id')
      const tableName = assertSafeIdentifier(readOwnProperty(entityConfig, 'tableName'), 'table name')
      const tableSql = resolvedSchema !== undefined
        ? '"' + assertSafeIdentifier(resolvedSchema, 'schema name') + '"."' + tableName + '"'
        : '"' + tableName + '"'

      JSON.stringify({
        realmWasPolluted: ({}).schema === 'polluted schema',
        resolvedSchemaIsUndefined: resolvedSchema === undefined,
        resolvedCurrencyFieldIsUndefined: resolvedCurrencyField === undefined,
        resolvedLabelResolversIsUndefined: resolvedLabelResolvers === undefined,
        hasPollutedField,
        hasIdField,
        tableSql,
      })
      `,
      realm,
    )

    expect(JSON.parse(outcome)).toEqual({
      realmWasPolluted: true,
      resolvedSchemaIsUndefined: true,
      resolvedCurrencyFieldIsUndefined: true,
      resolvedLabelResolversIsUndefined: true,
      hasPollutedField: false,
      hasIdField: true,
      tableSql: '"sales_orders"',
    })
    // Global Jest realm remains completely clean.
    expect(({} as Record<string, unknown>).schema).toBeUndefined()
    expect(({} as Record<string, unknown>).pollutedField).toBeUndefined()
  })
})
