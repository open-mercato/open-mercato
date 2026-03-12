import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import StripePaymentLinkWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'gateway_stripe.injection.payment-link',
    title: 'Stripe payment link checkout',
    priority: 100,
  },
  Widget: StripePaymentLinkWidget,
}

export default widget
