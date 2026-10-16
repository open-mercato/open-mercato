export const metadata = {
  requireAuth: true,
  requireFeatures: ['ledger.accounts.manage'],
  pageTitle: 'Edit Account Type',
  pageTitleKey: 'ledger.account_types.edit.title',
  pageGroup: 'General Ledger',
  pageGroupKey: 'ledger.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Account Types', labelKey: 'ledger.account_types.page.title', href: '/backend/account-types' },
    { label: 'Edit', labelKey: 'ledger.account_types.edit.title' },
  ],
}
