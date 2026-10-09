import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['gateway_tpay.view', 'gateway_tpay.configure'],
    admin: ['gateway_tpay.view', 'gateway_tpay.configure'],
  },
}

export default setup
