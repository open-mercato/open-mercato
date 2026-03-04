import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['shipping_carriers.*'],
    admin: ['shipping_carriers.*'],
    employee: ['shipping_carriers.view'],
  },
}

export default setup
