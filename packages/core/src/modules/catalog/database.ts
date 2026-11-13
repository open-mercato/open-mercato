import type { DatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'

export const databaseDeclarations: DatabaseModuleDeclarations = {
  storageTables: [
    'catalog_product_option_values',
    'catalog_product_options',
    'catalog_product_variant_option_values',
    'catalog_variant_option_values',
  ].map((table) => ({
    schema: 'public', table, tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false,
    classification: 'deferred',
    reason: 'Legacy option storage retained by catalog migrations; application scoping remains required until separately reviewed for enrollment.',
  })),
}
