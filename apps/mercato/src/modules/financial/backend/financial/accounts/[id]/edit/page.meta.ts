export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'Edit account',
  pageTitleKey: 'financial.accounts.form.edit.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 400,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Chart of accounts', labelKey: 'financial.accounts.page.title' },
    { label: 'Edit account', labelKey: 'financial.accounts.form.edit.title' },
  ],
}
