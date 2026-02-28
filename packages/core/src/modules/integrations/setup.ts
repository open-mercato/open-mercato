import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['integrations.view', 'integrations.manage'],
    admin: ['integrations.view', 'integrations.manage'],
    employee: ['integrations.view'],
  },
}

export default setup
