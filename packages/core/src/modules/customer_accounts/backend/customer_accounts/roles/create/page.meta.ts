export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_accounts.roles.manage'],
  pageTitle: 'Create Customer Role',
  pageTitleKey: 'customer_accounts.nav.role_create',
  navHidden: true,
  breadcrumb: [
    { label: 'Customer Accounts', labelKey: 'customer_accounts.nav.users', href: '/backend/customer_accounts' },
    { label: 'Roles', labelKey: 'customer_accounts.nav.roles', href: '/backend/customer_accounts/roles' },
    { label: 'Create Role', labelKey: 'customer_accounts.nav.role_create' },
  ],
} as const
