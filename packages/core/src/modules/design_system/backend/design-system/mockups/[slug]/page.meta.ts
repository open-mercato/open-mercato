export const metadata = {
  requireAuth: true,
  requireFeatures: ['design_system.view'],
  pageTitle: 'Mockup',
  pageTitleKey: 'design_system.mockups.detailTitle',
  pageGroup: 'Developer',
  pageGroupKey: 'design_system.nav.group',
  navHidden: true,
  breadcrumb: [
    { label: 'Design system', labelKey: 'design_system.nav.title', href: '/backend/design-system' },
    {
      label: 'Screen mockups',
      labelKey: 'design_system.mockups.title',
      href: '/backend/design-system/mockups',
    },
  ],
}
