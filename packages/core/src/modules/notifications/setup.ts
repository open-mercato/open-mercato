import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['notifications.*'],
    admin: ['notifications.*'],
    employee: ['notifications.view'],
  },
}

export default setup
