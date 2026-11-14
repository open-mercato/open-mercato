import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['data_erasure.*'],
    admin: ['data_erasure.*'],
  },
}

export default setup
