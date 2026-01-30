import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'

export const analyticsConfig: AnalyticsModuleConfig = {
  entities: [
    {
      entityId: 'catalog:products',
      requiredFeatures: ['catalog.view'],
      entityConfig: {
        tableName: 'catalog_products',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        name: { dbColumn: 'name', type: 'text' },
        status: { dbColumn: 'status', type: 'text' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
      },
    },
  ],
}

export default analyticsConfig
export const config = analyticsConfig
