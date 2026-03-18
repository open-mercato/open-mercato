import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['webhooks.*'],
    employee: ['webhooks.view', 'webhooks.deliveries.view'],
  },
}

export default setup
