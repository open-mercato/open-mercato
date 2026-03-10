import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerGatewayAdapter, registerWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import { stripeAdapterV20241218 } from './lib/adapters/v2024-12-18'
import { stripeAdapterV20231016 } from './lib/adapters/v2023-10-16'
import { verifyStripeWebhook } from './lib/webhook-handler'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['gateway_stripe.view', 'gateway_stripe.configure'],
    admin: ['gateway_stripe.view', 'gateway_stripe.configure'],
  },

  async onTenantCreated() {
    registerGatewayAdapter(stripeAdapterV20241218, { version: '2024-12-18' })
    registerGatewayAdapter(stripeAdapterV20231016, { version: '2023-10-16' })
    registerWebhookHandler('stripe', verifyStripeWebhook, { queue: 'stripe-webhook' })
  },
}

export default setup
