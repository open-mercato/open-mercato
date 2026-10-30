import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['availability.*'],
    employee: ['availability.policies.view'],
  },
}

export default setup
