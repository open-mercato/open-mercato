import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { registerSignInSchedules } from './lib/sign-in-schedules'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['security.*'],
    admin: ['security.*', 'security.sign_ins.view'],
    employee: ['security.profile.view', 'security.profile.password', 'security.profile.manage', 'security.mfa.manage'],
  },
  async seedDefaults({ container }) {
    await registerSignInSchedules(container)
  },
}

export default setup
