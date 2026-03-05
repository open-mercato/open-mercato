import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'gateway_przelewy24',
  title: 'Przelewy24',
  description: 'Accept payments through Przelewy24.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'przelewy24',
  docsUrl: 'https://developers.przelewy24.pl',
  package: '@open-mercato/core',
  version: '1.0.0',
  author: 'Open Mercato Team',
  license: 'MIT',
  credentials: {
    fields: [
      { key: 'merchantId', label: 'Merchant ID', type: 'text', required: true },
      { key: 'crcKey', label: 'CRC Key', type: 'secret', required: true },
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
    ],
  },
}
