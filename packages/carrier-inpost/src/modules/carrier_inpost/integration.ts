import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'carrier_inpost',
  title: 'InPost',
  description: 'Create shipments and track delivery status via InPost.',
  category: 'shipping',
  hub: 'shipping_carriers',
  providerKey: 'inpost',
  docsUrl: 'https://inpost.pl',
  package: '@open-mercato/carrier-inpost',
  version: '1.0.0',
  author: 'Open Mercato Team',
  license: 'MIT',
  credentials: {
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
      { key: 'organizationId', label: 'Organization ID', type: 'text', required: false },
    ],
  },
}
