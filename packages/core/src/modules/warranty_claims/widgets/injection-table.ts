import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'warranty_claims.injection.order-claims-tab',
      kind: 'tab',
      groupLabel: 'warranty_claims.widgets.orderClaims.tabLabel',
      priority: 40,
    },
  ],
  'detail:customers.person:tabs': [
    {
      widgetId: 'warranty_claims.injection.customer-claims-tab',
      kind: 'tab',
      groupLabel: 'warranty_claims.customerTab.title',
      priority: 40,
    },
  ],
  'detail:customers.company:tabs': [
    {
      widgetId: 'warranty_claims.injection.customer-claims-tab',
      kind: 'tab',
      groupLabel: 'warranty_claims.customerTab.title',
      priority: 40,
    },
  ],
}

export default injectionTable
