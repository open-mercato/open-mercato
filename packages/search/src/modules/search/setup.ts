import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['search.*', 'vector.*'],
    employee: ['vector.*'],
  },
}

export default setup
