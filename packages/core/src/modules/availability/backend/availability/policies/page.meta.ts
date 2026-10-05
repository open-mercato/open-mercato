export const metadata = {
  requireAuth: true,
  requireFeatures: ['availability.policies.view'],
  pageTitle: 'Availability Policies',
  pageTitleKey: 'availability.policies.nav.title',
  pageGroup: 'Availability',
  pageGroupKey: 'availability.nav.group',
  pageOrder: 10,
  pageContext: 'settings' as const,
  icon: 'boxes',
  breadcrumb: [{ label: 'Availability Policies', labelKey: 'availability.policies.nav.title' }],
}
