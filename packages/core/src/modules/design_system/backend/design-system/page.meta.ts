export const metadata = {
  requireAuth: true,
  requireFeatures: ['design_system.view'],
  pageTitle: 'Design system',
  pageTitleKey: 'design_system.nav.title',
  pageGroup: 'Developers',
  pageGroupKey: 'backend.nav.developers',
  pageOrder: 900,
  pageContext: 'settings' as const,
  icon: 'shapes',
  breadcrumb: [{ label: 'Design system', labelKey: 'design_system.nav.title' }],
}
