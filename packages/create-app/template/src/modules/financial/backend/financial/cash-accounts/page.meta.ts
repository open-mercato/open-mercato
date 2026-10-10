export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.payments.view'],
  pageTitle: 'Cash and bank accounts',
  pageTitleKey: 'financial.cashAccounts.page.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 440,
  icon: 'wallet',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Cash and bank accounts', labelKey: 'financial.cashAccounts.page.title' },
  ],
}
