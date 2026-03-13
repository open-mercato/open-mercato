import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'

export const analyticsConfig: AnalyticsModuleConfig = {
  entities: [
    {
      entityId: 'customers:entities',
      requiredFeatures: ['customers.view'],
      entityConfig: {
        tableName: 'customer_entities',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        kind: { dbColumn: 'kind', type: 'text' },
        status: { dbColumn: 'status', type: 'text' },
        lifecycleStage: { dbColumn: 'lifecycle_stage', type: 'text' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
        displayName: { dbColumn: 'display_name', type: 'text' },
      },
    },
    {
      entityId: 'customers:deals',
      requiredFeatures: ['customers.deals.view'],
      entityConfig: {
        tableName: 'customer_deals',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        valueAmount: { dbColumn: 'value_amount', type: 'numeric' },
        status: { dbColumn: 'status', type: 'text' },
        pipelineStage: { dbColumn: 'pipeline_stage', type: 'text' },
        probability: { dbColumn: 'probability', type: 'numeric' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
        expectedCloseAt: { dbColumn: 'expected_close_at', type: 'timestamp' },
      },
      labelResolvers: {
        customerEntityId: { table: 'customer_entities', idColumn: 'id', labelColumn: 'display_name' },
      },
    },
    {
      entityId: 'customers:customer_branch',
      requiredFeatures: ['customers.branches.view'],
      entityConfig: {
        tableName: 'customer_branches',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        name: { dbColumn: 'name', type: 'text' },
        branchType: { dbColumn: 'branch_type', type: 'text' },
        specialization: { dbColumn: 'specialization', type: 'text' },
        budget: { dbColumn: 'budget', type: 'numeric' },
        headcount: { dbColumn: 'headcount', type: 'numeric' },
        isActive: { dbColumn: 'is_active', type: 'boolean' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
      },
      labelResolvers: {
        companyEntityId: { table: 'customer_entities', idColumn: 'id', labelColumn: 'display_name' },
      },
    },
  ],
}

export default analyticsConfig
export const config = analyticsConfig
