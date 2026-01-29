import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['dictionaries.view', 'dictionaries.manage'],
    employee: ['dictionaries.view'],
  },
}

export default setup
