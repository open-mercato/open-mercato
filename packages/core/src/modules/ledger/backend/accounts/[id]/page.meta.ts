export const metadata = {
  requireAuth: true,
  requireFeatures: ['ledger.accounts.manage'],
  pageTitle: 'Edit Account',
  pageTitleKey: 'ledger.accounts.edit.title',
  pageGroup: 'General Ledger',
  pageGroupKey: 'ledger.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Chart of Accounts', labelKey: 'ledger.accounts.page.title', href: '/backend/accounts' },
    { label: 'Edit', labelKey: 'ledger.accounts.edit.title' },
  ],
}
