export const metadata = {
  requireAuth: true,
  requireFeatures: ['availability.check'],
  pageTitle: 'Availability Check',
  pageTitleKey: 'availability.check.nav.title',
  pageGroup: 'Availability',
  pageGroupKey: 'availability.nav.group',
  pageOrder: 20,
  pageContext: 'settings' as const,
  icon: 'search',
  breadcrumb: [{ label: 'Availability Check', labelKey: 'availability.check.nav.title' }],
}
