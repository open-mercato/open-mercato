import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['directory.tenants.*'],
    admin: ['directory.organizations.view', 'directory.organizations.manage'],
  },
}

export default setup
