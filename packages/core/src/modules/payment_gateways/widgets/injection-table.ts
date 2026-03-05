import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'data-table:sales.payments:columns': {
    widgetId: 'payment_gateways.injection.payment-status-column',
    priority: 50,
  },
  'crud-form:sales.payment_method:fields': {
    widgetId: 'payment_gateways.injection.payment-method-config-field',
    priority: 40,
  },
  'crud-form:sales.sales_payment_method:fields': {
    widgetId: 'payment_gateways.injection.payment-method-config-field',
    priority: 40,
  },
}

export default injectionTable
