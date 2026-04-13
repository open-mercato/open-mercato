import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['auth.*'],
    admin: ['auth.*'],
    employee: ['auth.view'],
  },
}

export default setup
