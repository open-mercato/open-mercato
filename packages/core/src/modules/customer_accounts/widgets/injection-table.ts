import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

const accountStatusWidget = {
  widgetId: 'customer_accounts.injection.account-status',
  kind: 'group',
  column: 2,
  groupLabel: 'customer_accounts.widgets.accountStatus',
  priority: 200,
} as const

const companyUsersWidget = {
  widgetId: 'customer_accounts.injection.company-users',
  kind: 'group',
  column: 2,
  groupLabel: 'customer_accounts.widgets.portalUsers',
  priority: 200,
} as const

export const injectionTable: ModuleInjectionTable = {
  'customers.person': [accountStatusWidget],
  'crud-form:customers.person': [accountStatusWidget],
  'crud-form:customers:customer_person_profile:fields': [accountStatusWidget],
  'customers.company': [companyUsersWidget],
  'crud-form:customers.company': [companyUsersWidget],
  'crud-form:customers:customer_company_profile:fields': [companyUsersWidget],
  // Step 4.10 — Portal AiChat injection example.
  // Mapped to the portal profile page's `pageAfter('profile')` spot;
  // third-party modules targeting other portal pages can copy this entry.
  'portal:profile:after': [
    {
      widgetId: 'customer_accounts.injection.portal-ai-assistant-trigger',
      priority: 100,
    },
  ],
}

export default injectionTable
