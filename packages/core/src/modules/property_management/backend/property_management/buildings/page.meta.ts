export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.view'],
  pageTitle: 'Buildings',
  pageTitleKey: 'property_management.nav.buildings',
  pageGroup: 'Facilities',
  pageGroupKey: 'property_management.nav.group',
  pageOrder: 110,
  icon: 'building',
  breadcrumb: [{ label: 'Buildings', labelKey: 'property_management.nav.buildings' }],
} as const
