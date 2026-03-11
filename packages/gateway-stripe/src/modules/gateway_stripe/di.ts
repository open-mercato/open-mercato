import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerGatewayAdapter, registerWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
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

  container.register({
    stripeHealthCheck: asValue(stripeHealthCheck),
  })
}
