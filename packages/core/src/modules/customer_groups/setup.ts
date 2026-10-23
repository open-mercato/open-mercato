import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['customer_groups.*'],
    admin: ['customer_groups.*'],
    employee: ['customer_groups.groups.view', 'customer_groups.memberships.view', 'customer_groups.terms.view'],
  },
}

export default setup
