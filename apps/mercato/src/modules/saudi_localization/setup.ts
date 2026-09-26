import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['saudi_localization.*'],
    admin: ['saudi_localization.*'],
    employee: ['saudi_localization.settings.view'],
  },
}

export default setup
