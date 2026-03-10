import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['security.*'],
    admin: ['security.profile.view', 'security.profile.password', 'security.profile.manage', 'security.sudo.view'],
    employee: ['security.profile.view', 'security.profile.password'],
  },
}

export default setup
