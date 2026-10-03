export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.write'],
  pageTitle: 'Schedule trip',
  pageTitleKey: 'transport_operations.trips.form.create.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 370,
  icon: 'calendar-clock',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Trips', labelKey: 'transport_operations.trips.page.title', href: '/backend/transport/trips' },
    { label: 'Schedule trip', labelKey: 'transport_operations.trips.form.create.title' },
  ],
}
