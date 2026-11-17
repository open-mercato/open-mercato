import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'configs.system_status.view',
      'configs.cache.view',
      'configs.cache.manage',
      'configs.manage',
      'configs.date_locale.view',
      'configs.date_locale.manage',
    ],
    employee: ['configs.date_locale.view'],
  },
}

export default setup
