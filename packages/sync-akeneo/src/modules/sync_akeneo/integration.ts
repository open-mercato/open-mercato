import { buildIntegrationDetailWidgetSpotId, type IntegrationBundle, type IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const syncAkeneoDetailWidgetSpotId = buildIntegrationDetailWidgetSpotId('sync_akeneo')

export const integration: IntegrationDefinition = {
  id: 'sync_akeneo',
  title: 'Akeneo PIM',
  description: 'Import Akeneo product catalogs, family-driven attributes, and products into Open Mercato with resilient batch sync.',
  category: 'data_sync',
  hub: 'data_sync',
  providerKey: 'akeneo',
  icon: 'database',
  docsUrl: 'https://api.akeneo.com/documentation/authentication.html',
  package: '@open-mercato/sync-akeneo',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['akeneo', 'pim', 'catalog', 'products', 'attributes', 'categories'],
  detailPage: {
    widgetSpotId: syncAkeneoDetailWidgetSpotId,
  },
  credentials: {
    fields: [
      {
        key: 'apiUrl',
        label: 'Akeneo URL',
        type: 'url',
        required: true,
        placeholder: 'https://your-instance.cloud.akeneo.com',
        helpText: 'Use the base Akeneo PIM URL, without a trailing slash.',
      },
      {
        key: 'clientId',
        label: 'Client ID',
        type: 'text',
        required: true,
        helpText: 'Create a connected app or API client in Akeneo and copy its client id.',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        type: 'secret',
        required: true,
        helpText: 'Use the client secret generated for the Akeneo API connection.',
      },
      {
        key: 'username',
        label: 'API Username',
        type: 'text',
        required: true,
        helpText: 'Create a dedicated Akeneo user for synchronization and grant only the product/catalog permissions it needs.',
      },
      {
        key: 'password',
        label: 'API Password',
        type: 'secret',
        required: true,
        helpText: 'Use the password for the dedicated Akeneo API user.',
      },
    ],
  },
  healthCheck: { service: 'akeneoHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
