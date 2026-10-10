export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'New account',
  pageTitleKey: 'financial.accounts.form.create.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 400,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Chart of accounts', labelKey: 'financial.accounts.page.title' },
    { label: 'New account', labelKey: 'financial.accounts.form.create.title' },
  ],
}
