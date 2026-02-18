import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'ecommerce.stores.view',
      'ecommerce.stores.manage',
      'ecommerce.storefront.view',
      'ecommerce.storefront.manage',
      'ecommerce.checkout.manage',
      'ecommerce.orders.view',
    ],
    employee: [
      'ecommerce.stores.view',
      'ecommerce.storefront.view',
      'ecommerce.orders.view',
    ],
  },
}

export default setup
