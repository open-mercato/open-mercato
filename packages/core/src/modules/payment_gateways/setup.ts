import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['payment_gateways.*', 'payment_gateways.view', 'payment_gateways.manage', 'payment_gateways.capture', 'payment_gateways.refund'],
    admin: ['payment_gateways.*', 'payment_gateways.view', 'payment_gateways.manage', 'payment_gateways.capture', 'payment_gateways.refund'],
    employee: ['payment_gateways.view'],
  },
}

export default setup
