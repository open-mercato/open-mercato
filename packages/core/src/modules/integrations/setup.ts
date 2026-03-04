import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['integrations.view', 'integrations.manage', 'integrations.credentials'],
    admin: ['integrations.view', 'integrations.manage', 'integrations.credentials'],
    employee: ['integrations.view'],
  },
}

export default setup
