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
}

export default injectionTable
