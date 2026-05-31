import type { DataQualityModuleConfig } from '@open-mercato/shared/modules/data-quality'

export const dataQualityConfig: DataQualityModuleConfig = {
  targets: [
    {
      entityId: 'customers:people',
      label: 'People',
      requiredFeatures: ['customers.people.view'],
      tableName: 'customer_entities',
      idColumn: 'id',
      scopeColumns: {
        tenantId: 'tenant_id',
        organizationId: 'organization_id',
      },
      fieldMappings: {
        displayName: { dbColumn: 'display_name', type: 'text' },
        primaryEmail: { dbColumn: 'primary_email', type: 'text', nullable: true },
        primaryPhone: { dbColumn: 'primary_phone', type: 'text', nullable: true },
        status: { dbColumn: 'status', type: 'text', nullable: true },
        lifecycleStage: { dbColumn: 'lifecycle_stage', type: 'text', nullable: true },
        source: { dbColumn: 'source', type: 'text', nullable: true },
      },
      recordLink: '/backend/customers/people/{id}',
      labelField: 'displayName',
    },
  ],
}

export default dataQualityConfig
