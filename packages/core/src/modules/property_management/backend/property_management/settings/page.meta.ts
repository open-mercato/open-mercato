export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.manage'],
  pageTitle: 'Settings',
  pageTitleKey: 'property_management.nav.settings',
  pageGroup: 'Facilities',
  pageGroupKey: 'property_management.nav.group',
  pageOrder: 190,
  icon: 'settings',
  breadcrumb: [{ label: 'Settings', labelKey: 'property_management.nav.settings' }],
} as const
