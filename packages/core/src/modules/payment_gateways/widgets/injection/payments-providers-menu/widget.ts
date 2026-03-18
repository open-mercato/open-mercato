import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'payment_gateways.injection.payments-providers-menu',
  },
  menuItems: [
    {
      id: 'payment-providers',
      labelKey: 'payment_gateways.nav.providers',
      label: 'Payment Providers',
      href: '/backend/integrations?category=payment',
      groupId: 'payments',
      groupLabelKey: 'payment_gateways.nav.paymentsGroup',
    },
  ],
}

export default widget
