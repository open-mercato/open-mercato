import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import StripeOrderCheckoutWidget from './widget.client'

type SalesOrderContext = {
  kind?: 'order' | 'quote'
  record?: Record<string, unknown>
}

const widget: InjectionWidgetModule<SalesOrderContext> = {
  metadata: {
    id: 'gateway_stripe.injection.order-checkout',
    title: 'Stripe Checkout',
    description: 'Create and open a Stripe checkout session from sales order detail.',
    features: ['gateway_stripe.checkout'],
  },
  Widget: StripeOrderCheckoutWidget,
}

export default widget
