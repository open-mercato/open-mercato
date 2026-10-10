export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.payments.manage'],
  pageTitle: 'Edit account',
  pageTitleKey: 'financial.cashAccounts.form.edit.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 440,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Cash and bank accounts', labelKey: 'financial.cashAccounts.page.title' },
    { label: 'Edit account', labelKey: 'financial.cashAccounts.form.edit.title' },
  ],
}
