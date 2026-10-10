export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Chart of accounts',
  pageTitleKey: 'financial.accounts.page.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 400,
  icon: 'book-open',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Chart of accounts', labelKey: 'financial.accounts.page.title' },
  ],
}
