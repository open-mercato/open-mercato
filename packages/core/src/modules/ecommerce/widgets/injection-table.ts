import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'sales.document.detail.order:details': [
    {
      widgetId: 'ecommerce.injection.storefront-order-source',
      kind: 'group',
      groupLabel: 'ecommerce.widgets.storefrontSource.groupLabel',
      priority: 100,
    },
  ],
}

export default injectionTable
