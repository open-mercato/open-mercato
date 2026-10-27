import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'crud-form:catalog.product:fields': [
    {
      widgetId: 'property_management.injection.catalog-product-use',
      kind: 'group',
      column: 2,
      groupLabel: 'property_management.widgets.productUse.groupLabel',
      groupDescription: 'property_management.widgets.productUse.groupDescription',
      priority: 110,
    },
  ],
}

export default injectionTable
