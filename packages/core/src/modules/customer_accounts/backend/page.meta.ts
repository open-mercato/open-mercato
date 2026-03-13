export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_accounts.view'],
  pageTitle: 'Customer Accounts',
  pageTitleKey: 'customer_accounts.nav.users',
  pageGroup: 'Customers',
  pageGroupKey: 'customer_accounts.nav.group',
  pageOrder: 155,
  breadcrumb: [
    { label: 'Customer Accounts', labelKey: 'customer_accounts.nav.users' },
  ],
} as const
