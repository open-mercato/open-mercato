import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const bundle: IntegrationBundle = {
  id: 'sync_medusa',
  title: 'Medusa',
  description: 'Bidirectional sync with Medusa.',
  icon: 'medusa',
  package: '@open-mercato/sync-medusa',
  version: '1.0.0',
  author: 'Open Mercato Team',
  credentials: {
    fields: [
      { key: 'medusaApiUrl', label: 'Medusa API URL', type: 'url', required: true },
      { key: 'medusaApiKey', label: 'API Key', type: 'secret', required: true },
    ],
  },
}

export const integrations: IntegrationDefinition[] = [
  {
    id: 'sync_medusa_products',
    title: 'Medusa Products',
    description: 'Sync products from Medusa',
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: 'medusa_products',
    bundleId: 'sync_medusa',
    credentials: { fields: [] },
    tags: ['products', 'catalog'],
  },
  {
    id: 'sync_medusa_orders',
    title: 'Medusa Orders',
    description: 'Sync orders from Medusa',
    category: 'data_sync',
    hub: 'data_sync',
    providerKey: 'medusa_orders',
    bundleId: 'sync_medusa',
    credentials: { fields: [] },
    tags: ['orders'],
  },
]
