export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.view'],
  pageTitle: 'Floor plan',
  pageTitleKey: 'property_management.nav.floorPlan',
  pageGroup: 'Facilities',
  pageGroupKey: 'property_management.nav.group',
  pageOrder: 100,
  icon: 'map',
  breadcrumb: [{ label: 'Floor plan', labelKey: 'property_management.nav.floorPlan' }],
} as const
