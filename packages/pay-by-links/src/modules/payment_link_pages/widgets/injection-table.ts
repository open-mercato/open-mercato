import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'crud-form:payment_gateways.transaction-create': [
    {
      widgetId: 'payment_link_pages.injection.transaction-create-link',
      kind: 'group',
      column: 2,
      groupLabel: 'payment_gateways.create.paymentLinkToggle',
      priority: 90,
    },
  ],
  'data-table:payment_gateways.transactions.list:actions': [
    {
      widgetId: 'payment_link_pages.injection.transaction-create-action',
      priority: 100,
    },
  ],
  'payment_gateways.transaction.detail:tabs': [
    {
      widgetId: 'payment_link_pages.injection.transaction-detail-customer-data',
      kind: 'tab',
      groupLabel: 'Payment Link',
      priority: 100,
    },
  ],
}

export default injectionTable
