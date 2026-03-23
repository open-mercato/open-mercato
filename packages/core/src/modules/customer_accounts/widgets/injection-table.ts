import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'crud-form:customers:customer_person_profile:fields': [
    {
      widgetId: 'customer_accounts.injection.account-status',
      kind: 'group',
      column: 2,
      groupLabel: 'customer_accounts.widgets.accountStatus',
      priority: 200,
    },
  ],
  'crud-form:customers:customer_company_profile:fields': [
    {
      widgetId: 'customer_accounts.injection.company-users',
      kind: 'group',
      column: 2,
      groupLabel: 'customer_accounts.widgets.portalUsers',
      priority: 200,
    },
  ],
}

export default injectionTable
