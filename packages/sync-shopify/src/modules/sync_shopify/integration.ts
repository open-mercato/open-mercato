import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'
import { DEFAULT_SHOPIFY_API_VERSION, SHOPIFY_API_VERSIONS, SHOPIFY_PROVIDER_KEY } from './lib/types'

export const integration: IntegrationDefinition = {
  id: 'sync_shopify',
  title: 'Shopify',
  description: 'Import Shopify products, customers, and orders into Open Mercato.',
  category: 'data_sync',
  hub: 'data_sync',
  providerKey: SHOPIFY_PROVIDER_KEY,
  icon: 'shopping-bag',
  docsUrl: 'https://shopify.dev/docs/api/admin-graphql',
  package: '@open-mercato/sync-shopify',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['shopify', 'catalog', 'customers', 'orders', 'commerce'],
  credentials: {
    fields: [
      {
        key: 'shopDomain',
        label: 'Shop domain',
        labelKey: 'sync_shopify.credentials.shopDomain.label',
        type: 'text',
        required: true,
        placeholder: 'your-store.myshopify.com',
        placeholderKey: 'sync_shopify.credentials.shopDomain.placeholder',
        helpText: 'The *.myshopify.com host, without https://.',
        helpTextKey: 'sync_shopify.credentials.shopDomain.help',
      },
      {
        key: 'clientId',
        label: 'Client ID',
        labelKey: 'sync_shopify.credentials.clientId.label',
        type: 'text',
        required: true,
        helpText: 'Client ID from the Dev Dashboard app settings. Release read_products, read_customers, and read_orders, then install the app on this shop.',
        helpTextKey: 'sync_shopify.credentials.clientId.help',
      },
      {
        key: 'clientSecret',
        label: 'Client secret',
        labelKey: 'sync_shopify.credentials.clientSecret.label',
        type: 'secret',
        required: true,
        helpText: 'Client secret from the same settings page. Open Mercato exchanges it for a short-lived Admin API token.',
        helpTextKey: 'sync_shopify.credentials.clientSecret.help',
      },
      {
        key: 'apiVersion',
        label: 'API version',
        labelKey: 'sync_shopify.credentials.apiVersion.label',
        type: 'select',
        helpText: 'Shopify Admin API version used for GraphQL. Defaults to 2026-07.',
        helpTextKey: 'sync_shopify.credentials.apiVersion.help',
        options: SHOPIFY_API_VERSIONS.map((value) => ({
          value,
          label: value,
        })),
      },
    ],
  },
  apiVersions: SHOPIFY_API_VERSIONS.map((id) => ({
    id,
    label: id,
    status: 'stable' as const,
    default: id === DEFAULT_SHOPIFY_API_VERSION,
  })),
  healthCheck: { service: 'shopifyHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
