import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

// The portal account lives on its own person tab (#7499 follow-up): as a
// CrudForm group it either forced the narrow two-column form layout or sat as
// a stray card under the personal data, and it is not part of editing a person.
const accountStatusWidget = {
  widgetId: 'customer_accounts.injection.account-status',
  kind: 'tab',
  groupId: 'portal-account',
  groupLabel: 'customer_accounts.widgets.portalAccountTab',
  // Negative: after the person's built-in tabs (#8020 ordering contract).
  priority: -50,
} as const

// Column 1 on purpose (#4400): any column-2 group makes CrudForm switch the
// company detail page to the narrow 7fr/3fr two-column layout, compressing the
// left-side groups. Portal users belongs in the left stack as a full-width row.
const companyUsersWidget = {
  widgetId: 'customer_accounts.injection.company-users',
  kind: 'group',
  column: 1,
  groupLabel: 'customer_accounts.widgets.portalUsers',
  priority: 200,
} as const

export const injectionTable: ModuleInjectionTable = {
  'detail:customers.person:tabs': [accountStatusWidget],
  'customers.company': [companyUsersWidget],
  'crud-form:customers.company': [companyUsersWidget],
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
