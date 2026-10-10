export const metadata = {
  requireAuth: true,
  requireFeatures: ['financial.read'],
  pageTitle: 'Journal entries',
  pageTitleKey: 'financial.entries.page.title',
  pageGroup: 'Financial',
  pageGroupKey: 'financial.nav.group',
  pageOrder: 420,
  icon: 'scale',
  breadcrumb: [
    { label: 'Financial', labelKey: 'financial.nav.group' },
    { label: 'Journal entries', labelKey: 'financial.entries.page.title' },
  ],
}
