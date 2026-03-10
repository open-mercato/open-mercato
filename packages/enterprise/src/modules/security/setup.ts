import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['security.*'],
    admin: ['security.profile.view', 'security.profile.password', 'security.profile.manage', 'security.sudo.view'],
    employee: ['security.profile.view', 'security.profile.password'],
  },
  sudoProtected: [
    {
      type: 'feature',
      identifier: 'security.sudo.manage',
      ttlSeconds: 300,
      challengeMethod: 'auto',
    },
    {
      type: 'feature',
      identifier: 'security.admin.mfa.reset',
      ttlSeconds: 300,
      challengeMethod: 'auto',
    },
  ],
}

export default setup
