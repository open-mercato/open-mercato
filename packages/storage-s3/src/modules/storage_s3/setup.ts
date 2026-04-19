import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['storage_providers.manage'],
    admin: ['storage_providers.manage'],
  },
}

export default setup
