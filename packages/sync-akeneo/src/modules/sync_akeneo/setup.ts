import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['sync_akeneo.view', 'sync_akeneo.configure'],
    admin: ['sync_akeneo.view', 'sync_akeneo.configure'],
  },
}

export default setup
