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
