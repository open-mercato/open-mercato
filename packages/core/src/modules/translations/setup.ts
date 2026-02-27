import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['translations.*'],
    employee: ['translations.view', 'translations.manage'],
  },
}

export default setup
