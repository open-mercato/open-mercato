import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'integrations.detail:tabs': [
    {
      widgetId: 'gateway_stripe.injection.config',
      kind: 'tab',
      groupLabel: 'gatewayStripe.orderTabLabel',
      priority: 100,
    },
  ],
  'menu:sidebar:main': {
    widgetId: 'gateway_stripe.injection.menu',
    priority: 35,
  },
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'gateway_stripe.injection.order-checkout',
      kind: 'tab',
      groupLabel: 'gatewayStripe.orderTabLabel',
      priority: 20,
    },
  ],
}

export default injectionTable
