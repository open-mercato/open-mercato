import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['test_package.view'],
    admin: ['test_package.view'],
  },
}

export default setup
