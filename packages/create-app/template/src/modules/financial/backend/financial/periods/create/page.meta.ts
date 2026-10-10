export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'New period',
  pageTitleKey: 'financial.periods.form.create.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 410,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Accounting periods', labelKey: 'financial.periods.page.title' },
    { label: 'New period', labelKey: 'financial.periods.form.create.title' },
  ],
}
