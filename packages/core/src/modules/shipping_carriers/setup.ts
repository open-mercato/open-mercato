import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['shipping_carriers.view', 'shipping_carriers.manage'],
    admin: ['shipping_carriers.view', 'shipping_carriers.manage'],
    employee: ['shipping_carriers.view'],
  },
}

export default setup
