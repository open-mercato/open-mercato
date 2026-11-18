export const metadata = {
  requireAuth: true,
  requireFeatures: ['property_management.view'],
  pageTitle: 'Bookings',
  pageTitleKey: 'property_management.nav.bookings',
  pageGroup: 'Facilities',
  pageGroupKey: 'property_management.nav.group',
  pageOrder: 130,
  icon: 'calendar-clock',
  breadcrumb: [{ label: 'Bookings', labelKey: 'property_management.nav.bookings' }],
} as const
