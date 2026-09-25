import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['transport.*'],
    admin: ['transport.*'],
    employee: ['transport.read'],
  },
}

export default setup
