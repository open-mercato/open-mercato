import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'gateway_stripe.injection.menu',
  },
  menuItems: [
    {
      id: 'gateway-stripe-demo',
      labelKey: 'gatewayStripe.menu.demo',
      label: 'Stripe Demo',
      icon: 'CreditCard',
      href: '/backend/stripe-demo',
      features: ['gateway_stripe.checkout'],
      placement: { position: InjectionPosition.After, relativeTo: 'backend-sales' },
    },
  ],
}

export default widget
