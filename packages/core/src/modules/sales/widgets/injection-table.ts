import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'sales.injection.document-history',
      kind: 'tab',
      groupLabel: 'sales.documents.history.tabLabel',
      priority: 50,
    },
  ],
  'sales.document.detail.quote:tabs': [
    {
      widgetId: 'sales.injection.document-history',
      kind: 'tab',
      groupLabel: 'sales.documents.history.tabLabel',
      priority: 50,
    },
  ],
  'data-table:sales.payments:columns': {
    widgetId: 'sales.injection.payment-gateway-status-column',
    priority: 50,
  },
  'crud-form:sales.payment_method:fields': {
    widgetId: 'sales.injection.payment-gateway-config-field',
    priority: 40,
  },
  'crud-form:sales.sales_payment_method:fields': {
    widgetId: 'sales.injection.payment-gateway-config-field',
    priority: 40,
  },
}

export default injectionTable
