import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'gateway_payu',
  title: 'PayU',
  description: 'Accept payments through PayU.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'payu',
  docsUrl: 'https://developers.payu.com',
  package: '@open-mercato/gateway-payu',
  version: '1.0.0',
  author: 'Open Mercato Team',
  license: 'MIT',
  credentials: {
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: true },
      { key: 'merchantPosId', label: 'POS ID', type: 'text', required: true }
    ],
  },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
