export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_accounts.roles.manage'],
  pageTitle: 'Customer Role Detail',
  pageTitleKey: 'customer_accounts.nav.role_detail',
  navHidden: true,
  breadcrumb: [
    { label: 'Roles', labelKey: 'customer_accounts.nav.roles', href: '/backend/customer_accounts/roles' },
    { label: 'Role Detail', labelKey: 'customer_accounts.nav.role_detail' },
  ],
} as const
