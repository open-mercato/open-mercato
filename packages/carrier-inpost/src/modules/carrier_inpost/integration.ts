import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'carrier_inpost',
  title: 'InPost',
  description: 'Create shipments and track deliveries with InPost.',
  category: 'shipping',
  hub: 'shipping_carriers',
  providerKey: 'inpost',
  package: '@open-mercato/carrier-inpost',
  version: '1.0.0',
  tags: ['locker', 'courier', 'poland'],
  credentials: {
    fields: [
      { key: 'apiKey', label: 'API key', type: 'secret', required: false },
      { key: 'organizationId', label: 'Organization ID', type: 'text', required: false },
    ],
  },
}

export default integration
