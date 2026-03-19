import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  registerGatewayAdapter,
  registerPaymentGatewayDescriptor,
  registerWebhookHandler,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { stripeHealthCheck } from './lib/health'
import { stripeAdapterV20250224Acacia } from './lib/adapters/v2025-02-24.acacia'
import { stripeAdapterV20241218 } from './lib/adapters/v2024-12-18'
import { stripeAdapterV20231016 } from './lib/adapters/v2023-10-16'
import { readStripeSessionIdHint, verifyStripeWebhook } from './lib/webhook-handler'

export function register(container: AppContainer) {
  registerGatewayAdapter(stripeAdapterV20250224Acacia, { version: '2025-02-24.acacia' })
  registerGatewayAdapter(stripeAdapterV20241218, { version: '2024-12-18' })
  registerGatewayAdapter(stripeAdapterV20231016, { version: '2023-10-16' })
  registerWebhookHandler('stripe', verifyStripeWebhook, {
    queue: 'stripe-webhook',
    readSessionIdHint: readStripeSessionIdHint,
  })
  registerPaymentGatewayDescriptor({
    providerKey: 'stripe',
    label: 'Stripe',
    sessionConfig: {
      fields: [
        {
          key: 'captureMethod',
          label: 'Capture method',
          type: 'select',
          required: false,
          options: [
            { value: 'automatic', label: 'Automatic capture' },
            { value: 'manual', label: 'Manual capture' },
          ],
        },
        {
          key: 'paymentTypes',
          label: 'Payment methods',
          type: 'multiselect',
          required: false,
          options: [
            { value: 'card', label: 'Credit card' },
            { value: 'apple_pay', label: 'Apple Pay' },
            { value: 'google_pay', label: 'Google Pay' },
            { value: 'link', label: 'Link' },
          ],
        },
      ],
      supportedCurrencies: '*',
      supportedPaymentTypes: [
        { value: 'card', label: 'Card' },
        { value: 'apple_pay', label: 'Apple Pay' },
        { value: 'google_pay', label: 'Google Pay' },
        { value: 'link', label: 'Link' },
      ],
      presentation: 'redirect',
    },
  })

  container.register({
    stripeHealthCheck: asValue(stripeHealthCheck),
  })
}
