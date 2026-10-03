export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.read'],
  pageTitle: 'Trips',
  pageTitleKey: 'transport_operations.trips.page.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 360,
  icon: 'calendar-clock',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Trips', labelKey: 'transport_operations.trips.page.title' },
  ],
}
