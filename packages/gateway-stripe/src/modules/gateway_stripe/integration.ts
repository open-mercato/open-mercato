import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'gateway_stripe',
  title: 'Stripe',
  description: 'Accept card payments, Apple Pay, Google Pay, and selected local methods via Stripe Checkout.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'stripe',
  icon: 'stripe',
  docsUrl: 'https://docs.stripe.com',
  package: '@open-mercato/gateway-stripe',
  version: '1.0.0',
  author: 'Open Mercato Team',
  license: 'MIT',
  tags: ['cards', 'checkout', 'apple-pay', 'google-pay'],
  apiVersions: [
    {
      id: '2024-12-18',
      label: 'v2024-12-18 (latest)',
      status: 'stable',
      default: true,
      changelog: 'Checkout Session based flow with manual/automatic capture support.',
    },
  ],
  credentials: {
    fields: [
      { key: 'publishableKey', label: 'Publishable Key', type: 'text', required: false, placeholder: 'pk_live_...' },
      { key: 'secretKey', label: 'Secret Key', type: 'secret', required: false, placeholder: 'sk_live_...' },
      { key: 'webhookSecret', label: 'Webhook Signing Secret', type: 'secret', required: false, placeholder: 'whsec_...' },
    ],
  },
}

export default integration
