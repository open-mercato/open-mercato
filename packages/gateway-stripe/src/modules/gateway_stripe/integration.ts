import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import { stripeWebhookSetupGuide } from './webhook-guide'

export const integration: IntegrationDefinition = {
  id: 'gateway_stripe',
  title: 'Stripe',
  description: 'Accept card payments, Apple Pay, Google Pay, and bank transfers via Stripe.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'stripe',
  icon: 'stripe',
  docsUrl: 'https://docs.stripe.com',
  package: '@open-mercato/gateway-stripe',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['cards', 'apple-pay', 'google-pay', 'bank-transfer', 'checkout'],
  apiVersions: [
    {
      id: '2024-12-18',
      label: 'v2024-12-18 (latest)',
      status: 'stable',
      default: true,
      changelog: 'Payment Intents v2, improved error codes, enhanced refund metadata',
    },
    {
      id: '2023-10-16',
      label: 'v2023-10-16',
      status: 'deprecated',
      deprecatedAt: '2025-06-01',
      sunsetAt: '2026-12-01',
      migrationGuide: 'https://docs.stripe.com/upgrades#2024-12-18',
      changelog: 'Legacy Payment Intents API',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'publishableKey',
        label: 'Publishable Key',
        type: 'text',
        required: true,
        placeholder: 'pk_live_...',
        helpText: 'Stripe Dashboard -> Developers -> API keys. Copy the Publishable key for the same mode you use here (test or live).',
      },
      {
        key: 'secretKey',
        label: 'Secret Key',
        type: 'secret',
        required: true,
        helpText: 'Stripe Dashboard -> Developers -> API keys. Use the Secret key from the same mode. In live mode Stripe may only show it once, so reveal or rotate it there if needed.',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook Signing Secret',
        type: 'secret',
        required: true,
        placeholder: 'whsec_...',
        helpText: 'Use the Stripe endpoint signing secret that starts with whsec_, not your API key.',
        helpDetails: stripeWebhookSetupGuide,
      },
    ],
  },
  healthCheck: { service: 'stripeHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
