export const features = {
  'shipping_carriers.view': {
    name: 'View shipping carrier integrations',
    description: 'Allows users to view carrier rates, shipments, and tracking state.',
    module: 'shipping_carriers',
  },
  'shipping_carriers.manage': {
    name: 'Manage shipping carrier integrations',
    description: 'Allows users to calculate rates and create/cancel shipments with carriers.',
    module: 'shipping_carriers',
  },
} as const

export default features
