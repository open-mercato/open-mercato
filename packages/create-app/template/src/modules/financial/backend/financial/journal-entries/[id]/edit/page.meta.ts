export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'Edit journal entry',
  pageTitleKey: 'financial.entries.form.edit.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 420,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Journal entries', labelKey: 'financial.entries.page.title' },
    { label: 'Edit journal entry', labelKey: 'financial.entries.form.edit.title' },
  ],
}
