export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'Edit period',
  pageTitleKey: 'financial.periods.form.edit.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 410,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Accounting periods', labelKey: 'financial.periods.page.title' },
    { label: 'Edit period', labelKey: 'financial.periods.form.edit.title' },
  ],
}
