export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_accounts.view'],
  pageTitle: 'Customer Roles',
  pageTitleKey: 'customer_accounts.nav.roles',
  pageGroup: 'Customers',
  pageGroupKey: 'customer_accounts.nav.group',
  pageOrder: 156,
  breadcrumb: [
    { label: 'Customer Accounts', labelKey: 'customer_accounts.nav.users', href: '/backend/customer_accounts' },
    { label: 'Roles', labelKey: 'customer_accounts.nav.roles' },
  ],
} as const
