export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.payments.manage'],
  pageTitle: 'New cash or bank account',
  pageTitleKey: 'financial.cashAccounts.form.create.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 440,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Cash and bank accounts', labelKey: 'financial.cashAccounts.page.title' },
    { label: 'New cash or bank account', labelKey: 'financial.cashAccounts.form.create.title' },
  ],
}
