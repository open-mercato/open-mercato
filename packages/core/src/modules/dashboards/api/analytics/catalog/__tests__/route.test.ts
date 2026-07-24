/**
 * @jest-environment node
 */
import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'
import { createAnalyticsRegistry } from '../../../../services/analyticsRegistry'
import { buildAnalyticsCatalogResponse } from '../route'

const analyticsConfig: AnalyticsModuleConfig = {
  entities: [
    {
      entityId: 'demo:orders',
      requiredFeatures: ['demo.orders.view'],
      entityConfig: {
        tableName: 'demo_orders',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        totalAmount: { dbColumn: 'total_amount', type: 'numeric' },
        status: { dbColumn: 'status', type: 'text' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
        payload: { dbColumn: 'payload', type: 'jsonb' },
      },
    },
    {
      entityId: 'secret:events',
      requiredFeatures: ['secret.events.view'],
      entityConfig: {
        tableName: 'secret_events',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
      },
    },
  ],
}

describe('dashboards analytics catalog route', () => {
  test('derives field metadata and filters entities by required features', async () => {
    const registry = createAnalyticsRegistry([analyticsConfig])
    const checkFeatures = jest.fn(async (features: string[]) => !features.includes('secret.events.view'))

    const response = await buildAnalyticsCatalogResponse(
      registry,
      checkFeatures,
      (_key, fallback) => fallback ?? _key,
    )

    expect(response.entities.map((entity) => entity.entityType)).toEqual(['demo:orders'])
    expect(checkFeatures).toHaveBeenCalledWith(['demo.orders.view'])
    expect(checkFeatures).toHaveBeenCalledWith(['secret.events.view'])

    const entity = response.entities[0]
    expect(entity.dateField).toBe('createdAt')

    const numeric = entity.fields.find((field) => field.field === 'totalAmount')
    expect(numeric).toMatchObject({
      kind: 'numeric',
      aggregates: ['sum', 'avg', 'count', 'min', 'max'],
      groupable: false,
    })

    const jsonb = entity.fields.find((field) => field.field === 'payload')
    expect(jsonb).toMatchObject({
      kind: 'jsonb',
      aggregates: ['count'],
      groupable: false,
    })

    const timestamp = entity.fields.find((field) => field.field === 'createdAt')
    expect(timestamp).toMatchObject({
      kind: 'timestamp',
      aggregates: ['count'],
      groupable: true,
    })
  })

  test('only marks a uuid field groupable when it has a declared label resolver', async () => {
    const config: AnalyticsModuleConfig = {
      entities: [
        {
          entityId: 'demo:deals',
          requiredFeatures: [],
          entityConfig: {
            tableName: 'demo_deals',
            dateField: 'created_at',
            defaultScopeFields: ['tenant_id', 'organization_id'],
          },
          fieldMappings: {
            id: { dbColumn: 'id', type: 'uuid' },
            customerEntityId: { dbColumn: 'customer_entity_id', type: 'uuid' },
            createdAt: { dbColumn: 'created_at', type: 'timestamp' },
          },
          labelResolvers: {
            id: { table: 'demo_deals', idColumn: 'id', labelColumn: 'title' },
          },
        },
      ],
    }
    const registry = createAnalyticsRegistry([config])
    const response = await buildAnalyticsCatalogResponse(registry, async () => true, (_key, fallback) => fallback ?? _key)
    const entity = response.entities.find((candidate) => candidate.entityType === 'demo:deals')
    const fields = new Map((entity?.fields ?? []).map((field) => [field.field, field]))

    // uuid with a resolver -> groupable (renders a human label, not a GUID)
    expect(fields.get('id')?.groupable).toBe(true)
    // uuid without a resolver -> not groupable (would leak a GUID into the legend)
    expect(fields.get('customerEntityId')?.groupable).toBe(false)
    // timestamps stay groupable regardless of resolvers
    expect(fields.get('createdAt')?.groupable).toBe(true)
  })

  test('never marks an encrypted field groupable, even a plain text column', async () => {
    const config: AnalyticsModuleConfig = {
      entities: [
        {
          entityId: 'demo:people',
          requiredFeatures: [],
          entityConfig: { tableName: 'demo_people', dateField: 'created_at', defaultScopeFields: ['tenant_id'] },
          fieldMappings: {
            id: { dbColumn: 'id', type: 'uuid' },
            displayName: { dbColumn: 'display_name', type: 'text', encrypted: true },
            status: { dbColumn: 'status', type: 'text' },
          },
        },
      ],
    }
    const registry = createAnalyticsRegistry([config])
    const response = await buildAnalyticsCatalogResponse(registry, async () => true, (_key, fallback) => fallback ?? _key)
    const fields = new Map((response.entities[0]?.fields ?? []).map((field) => [field.field, field]))

    // encrypted text column -> never groupable (grouping ciphertext leaks it and is meaningless)
    expect(fields.get('displayName')?.groupable).toBe(false)
    // plain text column -> groupable as usual
    expect(fields.get('status')?.groupable).toBe(true)
  })

  test('localizes entity and field labels via override -> shared -> humanize fallback', async () => {
    const registry = createAnalyticsRegistry([analyticsConfig])
    const dictionary: Record<string, string> = {
      'dashboards.catalog.entities.demo:orders': 'Zamówienia demo',
      'dashboards.catalog.fields.status': 'Status PL',
      'dashboards.catalog.fields.demo:orders.id': 'Zamówienie',
    }
    const requestedKeys: string[] = []
    const translate = (key: string, fallback?: string) => {
      requestedKeys.push(key)
      return dictionary[key] ?? fallback ?? key
    }

    const response = await buildAnalyticsCatalogResponse(registry, async () => true, translate)
    const orders = response.entities.find((entity) => entity.entityType === 'demo:orders')
    expect(orders).toBeDefined()
    if (!orders) return

    expect(orders.label).toBe('Zamówienia demo')
    expect(orders.fields.find((field) => field.field === 'id')?.label).toBe('Zamówienie')
    expect(orders.fields.find((field) => field.field === 'status')?.label).toBe('Status PL')
    expect(orders.fields.find((field) => field.field === 'totalAmount')?.label).toBe('Total amount')

    expect(requestedKeys).toContain('dashboards.catalog.entities.demo:orders')
    expect(requestedKeys).toContain('dashboards.catalog.fields.status')
    expect(requestedKeys).toContain('dashboards.catalog.fields.demo:orders.status')
    expect(requestedKeys).toContain('dashboards.catalog.fields.id')
    expect(requestedKeys).toContain('dashboards.catalog.fields.demo:orders.id')
  })
})
