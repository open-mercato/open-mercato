import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionFieldWidget = {
  metadata: {
    id: 'sales.injection.payment-gateway-config-field',
    priority: 40,
  },
  fields: [
    {
      id: 'payment_gateways.captureMethod',
      label: 'payment_gateways.field.captureMethod',
      type: 'select',
      group: 'details',
      options: [
        { value: 'automatic', label: 'payment_gateways.captureMethod.automatic' },
        { value: 'manual', label: 'payment_gateways.captureMethod.manual' },
      ],
    },
    {
      id: 'payment_gateways.paymentTypes',
      label: 'payment_gateways.field.paymentTypes',
      type: 'text',
      group: 'details',
    },
  ],
}

export default widget
