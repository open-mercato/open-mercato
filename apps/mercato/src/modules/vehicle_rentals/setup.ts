import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['rentals.*'],
    admin: ['rentals.*', 'customers.companies.view', 'customers.people.view'],
    employee: ['rentals.read'],
  },
}

export default setup
