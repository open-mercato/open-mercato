import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

// All five cart.* ACL features (§10.3) gate staff/admin surfaces only — admin cart
// inspection, settings and proposal authoring. A buyer's own cart access is
// token-based (X-Cart-Token, §8.3), never ACL-gated, so there is no
// defaultCustomerRoleFeatures entry here.
export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['cart.*'],
    admin: ['cart.*'],
    employee: ['cart.carts.view'],
  },
}

export default setup
