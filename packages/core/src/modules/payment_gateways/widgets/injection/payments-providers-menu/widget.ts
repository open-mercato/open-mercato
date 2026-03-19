import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

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
      groupId: 'external-systems',
      features: ['integrations.view'],
      placement: {
        position: InjectionPosition.After,
        relativeTo: 'backend-integrations',
      },
    },
  ],
}

export default widget
