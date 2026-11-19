export const features = [
  {
    id: 'sync_shopify.view',
    title: 'View Shopify sync',
    module: 'sync_shopify',
    dependsOn: ['data_sync.view'],
  },
  {
    id: 'sync_shopify.configure',
    title: 'Configure Shopify sync',
    module: 'sync_shopify',
    dependsOn: ['sync_shopify.view', 'data_sync.configure'],
  },
]

export default features
