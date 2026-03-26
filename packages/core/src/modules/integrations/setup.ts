import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['integrations.*', 'integrations.view', 'integrations.manage', 'integrations.credentials.manage'],
    admin: ['integrations.*', 'integrations.view', 'integrations.manage', 'integrations.credentials.manage'],
    employee: ['integrations.view'],
  },
}

export default setup
