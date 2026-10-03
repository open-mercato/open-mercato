export const metadata = {
  requireAuth: true,
  requireFeatures: ['transport.write'],
  pageTitle: 'Edit trip',
  pageTitleKey: 'transport_operations.trips.form.edit.title',
  pageGroup: 'Transport',
  pageGroupKey: 'transport_operations.nav.group',
  pageOrder: 371,
  icon: 'calendar-clock',
  breadcrumb: [
    { label: 'Transport', labelKey: 'transport_operations.nav.group' },
    { label: 'Trips', labelKey: 'transport_operations.trips.page.title', href: '/backend/transport/trips' },
    { label: 'Edit trip', labelKey: 'transport_operations.trips.form.edit.title' },
  ],
}
