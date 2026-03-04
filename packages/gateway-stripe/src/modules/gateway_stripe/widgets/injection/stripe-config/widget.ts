import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import StripeConfigWidget from './widget.client'

type IntegrationDetailContext = {
  integrationId?: string
}

const widget: InjectionWidgetModule<IntegrationDetailContext> = {
  metadata: {
    id: 'gateway_stripe.injection.config',
    title: 'Stripe Settings',
    features: ['gateway_stripe.configure'],
    priority: 100,
  },
  Widget: StripeConfigWidget,
}

export default widget
