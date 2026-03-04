import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

const integration: IntegrationDefinition = {
  id: 'gateway_przelewy24',
  title: 'Przelewy24',
  description: 'Accept payments with Przelewy24.',
  category: 'payment',
  hub: 'payment_gateways',
  providerKey: 'przelewy24',
  package: '@open-mercato/gateway-przelewy24',
  version: '1.0.0',
  tags: ['cards', 'bank-transfer', 'poland'],
  credentials: {
    fields: [
      { key: 'merchantId', label: 'Merchant ID', type: 'text', required: false },
      { key: 'crc', label: 'CRC', type: 'secret', required: false },
      { key: 'apiKey', label: 'API key', type: 'secret', required: false },
      { key: 'webhookSecret', label: 'Webhook secret', type: 'secret', required: false },
    ],
  },
}

export default integration
