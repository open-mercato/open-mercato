import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['freight.*'],
    admin: [
      'freight.*',
      'customers.companies.view',
      'customers.people.view',
      'sales.orders.view',
      'sales.invoices.manage',
      'sales.payments.manage',
    ],
    employee: ['freight.read'],
  },
  defaultCustomerRoleFeatures: {
    buyer: ['portal.freight.view', 'portal.freight.respond', 'portal.freight.orders.create', 'portal.freight.rate'],
    viewer: ['portal.freight.view'],
  },
}

export default setup
