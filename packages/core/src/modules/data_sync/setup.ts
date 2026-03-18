import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['data_sync.view', 'data_sync.run', 'data_sync.configure'],
    admin: ['data_sync.view', 'data_sync.run', 'data_sync.configure'],
    employee: ['data_sync.view'],
  },
}

export default setup
