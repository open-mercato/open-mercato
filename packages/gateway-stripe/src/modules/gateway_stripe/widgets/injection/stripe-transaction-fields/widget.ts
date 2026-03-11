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
  ],
}

export default widget
