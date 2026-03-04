import { z } from 'zod'
import { registerIntegration } from '@open-mercato/shared/modules/integrations/types'
import { registerPaymentProvider } from '@open-mercato/core/modules/sales/lib/providers/registry'
import { registerGatewayAdapter } from '@open-mercato/core/modules/payment_gateways/lib/adapter-registry'
import { registerGatewayWebhookQueue } from '@open-mercato/core/modules/payment_gateways/lib/webhook-registry'
import { integration } from '../integration'
import { stripeAdapterV20241218, stripeAdapterV20231016 } from './adapter'
import { stripeGatewaySettingsSchema } from '../data/validators'

let initialized = false

export function registerStripeGatewayModule(): void {
  if (initialized) return
  initialized = true

  registerIntegration(integration)

  registerPaymentProvider({
    key: 'stripe',
    label: 'Stripe',
    description: 'Stripe Checkout sessions with card and wallet support.',
    settings: {
      fields: [
        { key: 'publishableKey', label: 'Publishable key', type: 'secret', required: false },
        { key: 'secretKey', label: 'Secret key', type: 'secret', required: false },
        { key: 'webhookSecret', label: 'Webhook secret', type: 'secret', required: false },
        {
          key: 'captureMethod',
          label: 'Capture method',
          type: 'select',
          options: [
            { value: 'automatic', label: 'Automatic' },
            { value: 'manual', label: 'Manual' },
          ],
        },
        {
          key: 'paymentMethodTypes',
          label: 'Payment methods',
          type: 'json',
          description: 'JSON array, for example ["card", "blik"].',
        },
        { key: 'successUrl', label: 'Success URL', type: 'url', required: false },
        { key: 'cancelUrl', label: 'Cancel URL', type: 'url', required: false },
      ],
      schema: stripeGatewaySettingsSchema.extend({
        paymentMethodTypes: z.array(z.string().trim().min(1)).default(['card']),
      }),
      defaults: {
        captureMethod: 'automatic',
        paymentMethodTypes: ['card'],
      },
    },
  })

  registerGatewayAdapter(stripeAdapterV20241218, { version: '2024-12-18', isDefault: true })
  registerGatewayAdapter(stripeAdapterV20231016, { version: '2023-10-16' })
  registerGatewayWebhookQueue('stripe', 'stripe-webhook')
}

registerStripeGatewayModule()
