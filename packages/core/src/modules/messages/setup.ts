import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['messages.*'],
    admin: ['messages.*'],
    employee: ['messages.*'],
  },
}

export default setup
