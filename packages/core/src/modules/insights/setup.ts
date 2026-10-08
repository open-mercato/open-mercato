import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['insights.*'],
    admin: ['insights.*'],
    employee: ['insights.explain.view'],
  },
}

export default setup
