import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'data-table:payment_gateways.transactions.list:toolbar': {
    widgetId: 'checkout.injection.payment-gateway-toolbar-link',
    priority: 20,
  },
  'admin.page:payment-gateways/transactions:after': {
    widgetId: 'checkout.injection.gateway-transaction-link',
    priority: 20,
  },
}

export default injectionTable
