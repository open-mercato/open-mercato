import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionFieldWidget = {
  metadata: {
    id: 'gateway_stripe.injection.transaction-fields',
    priority: 100,
  },
  fields: [
    {
      id: 'captureMethod',
      label: 'Capture method',
      type: 'select',
      group: 'provider',
      options: [
        { value: 'automatic', label: 'Automatic - charge immediately' },
        { value: 'manual', label: 'Manual - authorize first, capture later' },
      ],
    },
    {
      id: 'checkoutProfile',
      label: 'Pay Link Checkout Profile',
      type: 'select',
      group: 'provider',
      options: [
        { value: 'card', label: 'Card only' },
        { value: 'card_customer', label: 'Card with email and billing details' },
        { value: 'payment_element', label: 'Stripe Payment Element (inline methods)' },
        { value: 'payment_element_redirect', label: 'Stripe hosted checkout (redirect)' },
      ],
    },
  ],
}

export default widget
