import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['promotions.*'],
    admin: ['promotions.*'],
  },
}

export default setup
