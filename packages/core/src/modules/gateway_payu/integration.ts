import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

const integration: IntegrationDefinition = {
  id: 'gateway_payu',
  title: 'PayU',
  description: 'Accept payments with PayU.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'payu',
  package: '@open-mercato/core',
  version: '1.0.0',
  tags: ['cards', 'bank-transfer', 'blik'],
  credentials: {
    fields: [
      { key: 'clientId', label: 'Client ID', type: 'text', required: false },
      { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: false },
      { key: 'merchantPosId', label: 'Merchant POS ID', type: 'text', required: false },
      { key: 'secondKey', label: 'Second key', type: 'secret', required: false },
    ],
  },
}

export default integration
