import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: [
      'phone_calls.*',
    ],
    employee: [
      'phone_calls.view',
    ],
  },
}

export default setup
