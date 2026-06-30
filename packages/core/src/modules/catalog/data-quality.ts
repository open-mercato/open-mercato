import type { DataQualityModuleConfig } from '@open-mercato/shared/modules/data-quality'

export const dataQualityConfig: DataQualityModuleConfig = {
  targets: [
    {
      entityId: 'catalog:products',
      label: 'Products',
      requiredFeatures: ['catalog.view'],
      tableName: 'catalog_products',
      idColumn: 'id',
      scopeColumns: {
        tenantId: 'tenant_id',
        organizationId: 'organization_id',
      },
      fieldMappings: {
        title: { dbColumn: 'title', type: 'text' },
        description: { dbColumn: 'description', type: 'text', nullable: true },
        defaultMediaId: { dbColumn: 'default_media_id', type: 'uuid', nullable: true },
        sku: { dbColumn: 'sku', type: 'text', nullable: true },
        productType: {
          dbColumn: 'product_type',
          type: 'enum',
          enumValues: ['simple', 'configurable', 'virtual', 'downloadable', 'bundle', 'grouped'],
        },
      },
      recordLink: '/backend/catalog/products/{id}',
      labelField: 'title',
    },
  ],
}

export default dataQualityConfig
