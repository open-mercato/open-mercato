import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'crud-form:catalog.product:fields': [
    {
      widgetId: 'wms.injection.catalog-inventory-profile',
      kind: 'group',
      column: 2,
      groupLabel: 'wms.widgets.catalog.inventoryProfile.groupLabel',
      groupDescription: 'wms.widgets.catalog.inventoryProfile.groupDescription',
      priority: 120,
    },
  ],
  'crud-form:catalog.catalog_product_variant:fields': [
    {
      widgetId: 'wms.injection.catalog-inventory-profile',
      kind: 'group',
      column: 2,
      groupLabel: 'wms.widgets.catalog.inventoryProfile.groupLabel',
      groupDescription: 'wms.widgets.catalog.inventoryProfile.groupDescription',
      priority: 120,
    },
  ],
  'sales.document.detail.order:details': {
    widgetId: 'wms.injection.sales-order-stock-context',
    priority: 80,
  },
  'data-table:sales.order.items:columns': {
    widgetId: 'wms.injection.order-items-stock-column',
    priority: 50,
  },
}

export default injectionTable
