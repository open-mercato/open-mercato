import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['example.*', 'payment_gateways.*', 'shipping_carriers.*'],
    admin: ['example.*', 'payment_gateways.*', 'shipping_carriers.*'],
    employee: ['example.*', 'example.widgets.*', 'payment_gateways.view', 'shipping_carriers.view'],
  },
}

export default setup
