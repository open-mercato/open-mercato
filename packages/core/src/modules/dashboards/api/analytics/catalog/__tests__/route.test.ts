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
})
