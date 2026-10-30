import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'gateway_tpay',
  title: 'Tpay',
  description: 'Accept hosted PLN payments, BLIK, cards, and bank transfers via Tpay.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'tpay',
  icon: 'tpay',
  docsUrl: 'https://docs-api.tpay.com',
  package: '@open-mercato/gateway-tpay',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['bank-transfer', 'pay-by-link', 'blik', 'pln'],
  apiVersions: [
    {
      id: 'v1',
      label: 'Tpay Open API',
      status: 'stable',
      default: true,
      changelog: 'Hosted PLN payment sessions and status reads through the Tpay Open API.',
    },
  ],
  credentials: {
    fields: [
      {
        key: 'clientId',
        label: 'Client ID',
        type: 'text',
        required: true,
        helpText: 'Tpay Merchant Panel -> Integrations -> API. Create an API key and copy its Client ID.',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        type: 'secret',
        required: true,
        helpText: 'Tpay Merchant Panel -> Integrations -> API. Copy the Secret of the same API key as the Client ID.',
      },
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        options: [
          { value: 'sandbox', label: 'Sandbox' },
          { value: 'production', label: 'Production' },
        ],
        helpText: 'Use Sandbox with credentials from the Tpay sandbox panel and Production with live credentials.',
      },
      {
        key: 'notificationUrl',
        label: 'Notification URL',
        type: 'url',
        required: false,
        placeholder: 'https://shop.example.com/notifications/tpay',
        helpText: 'Public HTTPS address on port 443 (sandbox also allows HTTP and port 8080) without credentials, query string, or fragment. Leave empty if the Tpay Merchant Panel already configures the notification address.',
      },
      {
        key: 'notificationSecurityCode',
        label: 'Notification Security Code',
        type: 'secret',
        required: false,
        helpText: 'Tpay Merchant Panel -> Integrations -> Notifications. Security code used to verify payment notifications. Optional until notification handling is enabled.',
      },
    ],
  },
  healthCheck: { service: 'tpayHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
