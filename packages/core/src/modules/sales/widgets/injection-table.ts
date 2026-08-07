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
  // NOTE: the 'data-table:sales.payments:columns' binding for
  // 'sales.injection.payment-gateway-status-column' was removed here — it could never
  // resolve. PaymentsSection.tsx renders its DataTable with no perspective/injectionSpotId/
  // extensionTableId, so extensionTableId is null and the columns spot degrades to
  // '__disabled__:columns'. The widget itself is still registered and is now UNBOUND: giving
  // the payments table a real tableId so the gateway-status column finally renders is a sales
  // feature gap, tracked separately rather than silently reintroduced here.
  'crud-form:sales.payment_method:fields': {
    widgetId: 'sales.injection.payment-gateway-config-field',
    priority: 40,
  },
  'crud-form:sales.sales_payment_method:fields': {
    widgetId: 'sales.injection.payment-gateway-config-field',
    priority: 40,
  },
  'detail:sales.order:stage-bar': [],
  'detail:sales.order:closure': [],
  'detail:sales.quote:stage-bar': [],
  'detail:sales.quote:closure': [],
}

export default injectionTable
