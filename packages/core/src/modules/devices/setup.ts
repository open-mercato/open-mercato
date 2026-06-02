import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['devices.*'],
    admin: ['devices.*'],
    employee: ['devices.view', 'devices.manage'],
  },
}

export default setup
