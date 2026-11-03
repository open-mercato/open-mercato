import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

const supplierComplianceWidget = {
  widgetId: 'eudr.injection.supplier-compliance',
  kind: 'group',
  column: 2,
  groupLabel: 'eudr.supplierPanel.title',
  priority: 220,
} as const

export const injectionTable: ModuleInjectionTable = {
  'data-table:catalog.products.list:columns': [
    {
      widgetId: 'eudr.injection.product-column',
      priority: 50,
    },
  ],
  'sales.document.detail.order:details': [
    {
      widgetId: 'eudr.injection.order-compliance',
      kind: 'group',
      column: 2,
      groupLabel: 'eudr.orderPanel.groupLabel',
      priority: 210,
    },
  ],
  'detail:customers.company:footer': [supplierComplianceWidget],
  'customers.company.detail:details': [supplierComplianceWidget],
}

export default injectionTable
