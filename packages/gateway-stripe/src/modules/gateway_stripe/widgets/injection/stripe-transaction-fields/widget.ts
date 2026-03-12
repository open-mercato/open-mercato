import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionFieldWidget = {
  metadata: {
    id: 'gateway_stripe.injection.transaction-fields',
    priority: 100,
  },
  fields: [
    {
      id: 'captureMethod',
      label: 'gateway_stripe.config.captureMethod',
      type: 'select',
      group: 'provider',
      options: [
        { value: 'automatic', label: 'gateway_stripe.config.captureMethod.automatic' },
        { value: 'manual', label: 'gateway_stripe.config.captureMethod.manual' },
      ],
    },
    {
      id: 'checkoutProfile',
      label: 'gateway_stripe.config.checkoutProfile',
      type: 'select',
      group: 'provider',
      options: [
        { value: 'card', label: 'gateway_stripe.config.checkoutProfile.card' },
        { value: 'card_customer', label: 'gateway_stripe.config.checkoutProfile.cardCustomer' },
        { value: 'payment_element', label: 'gateway_stripe.config.checkoutProfile.paymentElement' },
        { value: 'payment_element_redirect', label: 'gateway_stripe.config.checkoutProfile.paymentElementRedirect' },
      ],
    },
  ],
}

export default widget
