export const metadata = {
  requireAuth: true,
  requireFeatures: ['ledger.accounts.manage'],
  pageTitle: 'Create Account',
  pageTitleKey: 'ledger.accounts.create.title',
  pageGroup: 'General Ledger',
  pageGroupKey: 'ledger.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Chart of Accounts', labelKey: 'ledger.accounts.page.title', href: '/backend/accounts' },
    { label: 'Create', labelKey: 'ledger.accounts.create.title' },
  ],
}
