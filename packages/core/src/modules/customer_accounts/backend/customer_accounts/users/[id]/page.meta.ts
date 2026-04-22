export const metadata = {
  requireAuth: true,
  requireFeatures: ['customer_accounts.view'],
  pageTitle: 'Customer User Detail',
  pageTitleKey: 'customer_accounts.nav.user_detail',
  navHidden: true,
  breadcrumb: [
    { label: 'Users', labelKey: 'customer_accounts.nav.users', href: '/backend/customer_accounts/users' },
    { label: 'User Detail', labelKey: 'customer_accounts.nav.user_detail' },
  ],
} as const
