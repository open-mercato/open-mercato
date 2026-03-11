import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['payment_gateways.*'],
    admin: ['payment_gateways.*'],
    employee: ['payment_gateways.view'],
  },
}

export default setup
