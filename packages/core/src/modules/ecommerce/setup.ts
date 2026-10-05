import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['ecommerce.*'],
    admin: ['ecommerce.*'],
    employee: ['ecommerce.stores.view'],
  },
}

export default setup
