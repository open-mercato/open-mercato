import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['gateway_stripe.*'],
    admin: ['gateway_stripe.*'],
    employee: ['gateway_stripe.view', 'gateway_stripe.checkout'],
  },
}

export default setup
