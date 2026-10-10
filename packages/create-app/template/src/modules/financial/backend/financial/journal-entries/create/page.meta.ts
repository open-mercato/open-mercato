export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.write'],
  pageTitle: 'New journal entry',
  pageTitleKey: 'financial.entries.form.create.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 420,
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Journal entries', labelKey: 'financial.entries.page.title' },
    { label: 'New journal entry', labelKey: 'financial.entries.form.create.title' },
  ],
}
